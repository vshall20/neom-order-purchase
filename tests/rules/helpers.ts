import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-neom-po';

export const UID = {
  admin: 'uid-admin',
  admin2: 'uid-admin-2',
  operator: 'uid-operator',
  purchase: 'uid-purchase',
  inward: 'uid-inward',
  pending: 'uid-pending',
  disabled: 'uid-disabled',
} as const;

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
}

/** Seed one profile per role, written with rules bypassed. */
export async function seedProfiles(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const profiles: [string, string, boolean][] = [
      [UID.admin, 'admin', true],
      [UID.admin2, 'admin', true],
      [UID.operator, 'operator', true],
      [UID.purchase, 'purchase_manager', true],
      [UID.inward, 'inward_manager', true],
      [UID.pending, 'pending', false],
      [UID.disabled, 'operator', false],
    ];
    for (const [uid, role, active] of profiles) {
      await setDoc(doc(db, 'users', uid), {
        name: uid,
        loginId: uid,
        email: `${uid}@neommodular.local`,
        role,
        active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** Write a document with rules bypassed, to set up a scenario. */
export async function seedDoc(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, path), data);
  });
}

export function dbFor(env: RulesTestEnvironment, uid: string | null): Firestore {
  const ctx = uid
    ? env.authenticatedContext(uid, { email: `${uid}@neommodular.local` })
    : env.unauthenticatedContext();
  return ctx.firestore() as unknown as Firestore;
}

interface OrderOverrides {
  [key: string]: unknown;
}

/** A complete, valid order document. Override only what a test cares about. */
export function orderDoc(overrides: OrderOverrides = {}): Record<string, unknown> {
  return {
    poNumber: 'PO-2026-0001',
    poSeq: 1,
    status: 'pending',
    vendor: 'Acme Supply Co.',
    vendorLower: 'acme supply co.',
    note: '',
    items: [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 5, received: 0 }],
    itemNames: ['bolt'],
    total: 50,
    expectedDate: null,
    createdBy: { uid: UID.admin, name: 'admin' },
    createdAt: serverTimestamp(),
    placedAt: serverTimestamp(),
    processedBy: null,
    receivedBy: null,
    completedBy: null,
    completedAt: null,
    deleted: false,
    deletedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

export function auditDoc(uid: string, role: string, overrides: OrderOverrides = {}) {
  return {
    at: serverTimestamp(),
    actor: { uid, name: uid, role },
    action: 'order.create',
    targetType: 'order',
    targetId: 'o1',
    poNumber: 'PO-2026-0001',
    summary: 'Created PO-2026-0001',
    changes: {},
    ...overrides,
  };
}
