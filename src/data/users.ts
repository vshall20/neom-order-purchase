import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { User as AuthUser } from 'firebase/auth';
import { db, LOGIN_DOMAIN } from '../firebase';
import type { AppRole, UserProfile } from '../types';
import { toDisplayLoginId } from '../auth/loginId';
import { toUserProfile } from './converters';
import { writeAudit } from './audit';

const usersCol = () => collection(db, 'users');

/**
 * First-login self-provisioning.
 *
 * Accounts are created by an admin in the Firebase Auth console, so the first
 * time someone signs in there is no profile document yet and the security rules
 * have no role to check. The signed-in user creates their own profile, but the
 * rules only accept it with `role: 'pending'` and `active: false` — so this
 * grants exactly nothing until an admin assigns a real role in the app.
 */
export async function ensureProfile(authUser: AuthUser): Promise<UserProfile> {
  const ref = doc(db, 'users', authUser.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return toUserProfile(existing as never);

  const email = (authUser.email ?? '').toLowerCase();
  const loginId = toDisplayLoginId(email, LOGIN_DOMAIN);

  await setDoc(ref, {
    name: authUser.displayName || loginId || 'New user',
    loginId,
    email,
    role: 'pending',
    active: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const created = await getDoc(ref);
  return toUserProfile(created as never);
}

/** Live subscription to the signed-in user's own profile. */
export function watchProfile(uid: string, cb: (profile: UserProfile | null) => void): () => void {
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    cb(snap.exists() ? toUserProfile(snap as never) : null);
  });
}

/** Live subscription to all profiles. Rules restrict listing to admins. */
export function watchUsers(cb: (users: UserProfile[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    query(usersCol(), orderBy('name')),
    (snap) => cb(snap.docs.map((d) => toUserProfile(d))),
    onError,
  );
}

/**
 * Assign a role (admin only).
 *
 * Rules forbid an admin from changing their own role or active flag, which is
 * what stops the last admin from accidentally locking everyone out.
 */
export async function setUserRole(
  actor: UserProfile,
  target: UserProfile,
  role: AppRole,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', target.uid), { role, updatedAt: serverTimestamp() });
  writeAudit(db, batch, actor, {
    action: 'user.role_change',
    targetType: 'user',
    targetId: target.uid,
    summary: `Set ${target.name}'s role to ${role}`,
    changes: { role: { from: target.role, to: role } },
  });
  await batch.commit();
}

/**
 * Activate or deactivate an account (admin only).
 *
 * Deactivating is the app's version of deletion: every security rule requires
 * `active == true`, so an inactive profile can neither read nor write anything.
 * Removing the Firebase Auth credential itself is a console operation.
 */
export async function setUserActive(
  actor: UserProfile,
  target: UserProfile,
  active: boolean,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', target.uid), { active, updatedAt: serverTimestamp() });
  writeAudit(db, batch, actor, {
    action: active ? 'user.activate' : 'user.deactivate',
    targetType: 'user',
    targetId: target.uid,
    summary: `${active ? 'Activated' : 'Deactivated'} ${target.name}`,
    changes: { active: { from: target.active, to: active } },
  });
  await batch.commit();
}

/** Rename a profile (admin only). The Auth account's email is unaffected. */
export async function setUserName(
  actor: UserProfile,
  target: UserProfile,
  name: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', target.uid), { name: name.trim(), updatedAt: serverTimestamp() });
  writeAudit(db, batch, actor, {
    action: 'user.role_change',
    targetType: 'user',
    targetId: target.uid,
    summary: `Renamed ${target.name} to ${name.trim()}`,
    changes: { name: { from: target.name, to: name.trim() } },
  });
  await batch.commit();
}
