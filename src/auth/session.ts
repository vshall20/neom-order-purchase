import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User as AuthUser,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, LOGIN_DOMAIN } from '../firebase';
import { ensureProfile, watchProfile } from '../data/users';
import type { UserProfile } from '../types';
import { toSignInEmail } from './loginId';

/** Maps Firebase auth error codes to something a warehouse user can act on. */
export function signInErrorMessage(e: unknown): string {
  const code = e instanceof FirebaseError ? e.code : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That login ID is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your admin.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect ID or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'Cannot reach the server. Check your connection.';
    default:
      return 'Could not sign in. Try again, or contact your admin.';
  }
}

export async function signIn(loginId: string, password: string): Promise<void> {
  const email = toSignInEmail(loginId, LOGIN_DOMAIN);
  if (!email || !password) throw new Error('Enter your login ID and password.');
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

export interface SessionHandlers {
  onSignedOut: () => void;
  /** Fires on sign-in and again whenever the profile changes (e.g. an admin
   *  assigns a role or deactivates the account while it is open). */
  onProfile: (profile: UserProfile) => void;
  onError: (message: string) => void;
}

/**
 * Wire Firebase auth state to the app.
 *
 * The profile is watched rather than read once, so a role change or a
 * deactivation takes effect in an already-open tab without a reload.
 */
export function startSession(handlers: SessionHandlers): () => void {
  let stopProfile: (() => void) | null = null;

  const stopAuth = onAuthStateChanged(auth, (user: AuthUser | null) => {
    stopProfile?.();
    stopProfile = null;

    if (!user) {
      handlers.onSignedOut();
      return;
    }

    void ensureProfile(user)
      .then(() => {
        stopProfile = watchProfile(user.uid, (profile) => {
          if (profile) handlers.onProfile(profile);
        });
      })
      .catch((e: unknown) => {
        handlers.onError(
          e instanceof FirebaseError && e.code === 'permission-denied'
            ? 'Your account exists but has no profile, and one could not be created. Contact your admin.'
            : 'Could not load your account. Try signing in again.',
        );
      });
  });

  return () => {
    stopProfile?.();
    stopAuth();
  };
}
