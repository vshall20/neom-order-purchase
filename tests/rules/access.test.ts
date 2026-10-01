import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { UID, auditDoc, dbFor, makeTestEnv, seedDoc, seedProfiles } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedProfiles(env);
});

describe('user profiles', () => {
  it('lets anyone signed in read their own profile', async () => {
    // Required: the role every other rule checks lives in this document.
    await assertSucceeds(getDoc(doc(dbFor(env, UID.pending), `users/${UID.pending}`)));
    await assertSucceeds(getDoc(doc(dbFor(env, UID.disabled), `users/${UID.disabled}`)));
  });

  it('lets only an admin list every profile', async () => {
    await assertSucceeds(getDocs(collection(dbFor(env, UID.admin), 'users')));
    for (const uid of [UID.operator, UID.purchase, UID.inward]) {
      await assertFails(getDocs(collection(dbFor(env, uid), 'users')));
    }
  });

  it('lets a new sign-in self-provision an inactive pending profile', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(env, 'uid-fresh'), 'users/uid-fresh'), {
        name: 'Fresh',
        loginId: 'uid-fresh',
        email: 'uid-fresh@neommodular.com',
        role: 'pending',
        active: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('stops a new sign-in making themselves an admin', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, 'uid-fresh'), 'users/uid-fresh'), {
        name: 'Fresh',
        loginId: 'uid-fresh',
        email: 'uid-fresh@neommodular.com',
        role: 'admin',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('stops a new sign-in activating themselves', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, 'uid-fresh'), 'users/uid-fresh'), {
        name: 'Fresh',
        loginId: 'uid-fresh',
        email: 'uid-fresh@neommodular.com',
        role: 'pending',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('stops anyone creating a profile for someone else', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, UID.admin), 'users/uid-someone-else'), {
        name: 'Someone',
        loginId: 'someone',
        email: 'someone@neommodular.com',
        role: 'pending',
        active: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('lets an admin assign a role and activate an account', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.pending}`), {
        role: 'operator',
        active: true,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('stops an admin changing their own role or disabling themselves', async () => {
    // This is the lockout guard: without it the last admin can strand
    // the whole organisation, with no Admin SDK available to recover.
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.admin}`), { role: 'operator' }),
    );
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.admin}`), { active: false }),
    );
  });

  it('lets one admin manage another admin', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.admin2}`), { active: false }),
    );
  });

  it('stops a non-admin promoting anyone, including themselves', async () => {
    for (const uid of [UID.operator, UID.purchase, UID.inward]) {
      await assertFails(updateDoc(doc(dbFor(env, uid), `users/${uid}`), { role: 'admin' }));
      await assertFails(updateDoc(doc(dbFor(env, uid), `users/${UID.pending}`), { role: 'admin' }));
    }
  });

  it('stops an admin editing fields outside the allowed set', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.operator}`), { email: 'hijack@evil.com' }),
    );
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), `users/${UID.operator}`), { loginId: 'hijacked' }),
    );
  });

  it('never allows deleting a profile', async () => {
    await assertFails(deleteDoc(doc(dbFor(env, UID.admin), `users/${UID.operator}`)));
  });
});

describe('item catalog', () => {
  const item = {
    name: 'Angle bar 2in',
    nameLower: 'angle bar 2in',
    unit: 'pcs',
    defaultPrice: 120,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: { uid: UID.purchase, name: 'pm' },
  };

  it('lets admins and purchase managers add items', async () => {
    await assertSucceeds(setDoc(doc(dbFor(env, UID.purchase), 'itemCatalog/c1'), item));
    await assertSucceeds(setDoc(doc(dbFor(env, UID.admin), 'itemCatalog/c2'), item));
  });

  it('lets an operator add an item, so naming a new material files it', async () => {
    await assertSucceeds(setDoc(doc(dbFor(env, UID.operator), 'itemCatalog/c3'), item));
  });

  it('still stops an operator editing, repricing or disabling an existing item', async () => {
    await seedDoc(env, 'itemCatalog/c1', item);
    const db = dbFor(env, UID.operator);
    await assertFails(updateDoc(doc(db, 'itemCatalog/c1'), { defaultPrice: 1 }));
    await assertFails(updateDoc(doc(db, 'itemCatalog/c1'), { name: 'Renamed', nameLower: 'renamed' }));
    await assertFails(updateDoc(doc(db, 'itemCatalog/c1'), { active: false }));
  });

  it('stops an inward manager adding items', async () => {
    await assertFails(setDoc(doc(dbFor(env, UID.inward), 'itemCatalog/c4'), item));
  });

  it('stops an operator adding a pre-disabled or negatively priced item', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, UID.operator), 'itemCatalog/c5'), { ...item, active: false }),
    );
    await assertFails(
      setDoc(doc(dbFor(env, UID.operator), 'itemCatalog/c6'), { ...item, defaultPrice: -1 }),
    );
  });

  it('stops a user with no role assigned adding items', async () => {
    await assertFails(setDoc(doc(dbFor(env, UID.pending), 'itemCatalog/c7'), item));
    await assertFails(setDoc(doc(dbFor(env, UID.disabled), 'itemCatalog/c8'), item));
  });

  it('rejects an item with no name or a negative price', async () => {
    await assertFails(setDoc(doc(dbFor(env, UID.purchase), 'itemCatalog/c5'), { ...item, name: '' }));
    await assertFails(
      setDoc(doc(dbFor(env, UID.purchase), 'itemCatalog/c6'), { ...item, defaultPrice: -1 }),
    );
  });

  it('lets every active role read the catalog', async () => {
    await seedDoc(env, 'itemCatalog/c1', item);
    for (const uid of [UID.admin, UID.operator, UID.purchase, UID.inward]) {
      await assertSucceeds(getDocs(collection(dbFor(env, uid), 'itemCatalog')));
    }
    await assertFails(getDocs(collection(dbFor(env, UID.pending), 'itemCatalog')));
  });

  it('never allows deleting an item, so order history still resolves', async () => {
    await seedDoc(env, 'itemCatalog/c1', item);
    await assertFails(deleteDoc(doc(dbFor(env, UID.admin), 'itemCatalog/c1')));
    // Disabling is the supported alternative.
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.admin), 'itemCatalog/c1'), { active: false }));
  });
});

describe('audit log', () => {
  it('lets any active user append an entry in their own name', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(env, UID.operator), 'auditLog/a1'), auditDoc(UID.operator, 'operator')),
    );
  });

  it('stops an entry being forged in someone else s name', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, UID.operator), 'auditLog/a2'), auditDoc(UID.admin, 'admin')),
    );
  });

  it('stops an entry claiming a role the actor does not have', async () => {
    await assertFails(
      setDoc(doc(dbFor(env, UID.operator), 'auditLog/a3'), auditDoc(UID.operator, 'admin')),
    );
  });

  it('stops a back-dated entry', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'auditLog/a4'),
        auditDoc(UID.operator, 'operator', { at: new Date('2020-01-01') }),
      ),
    );
  });

  it('is append-only — no edits, no deletes, not even for an admin', async () => {
    await seedDoc(env, 'auditLog/a5', auditDoc(UID.admin, 'admin'));
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'auditLog/a5'), { summary: 'rewritten' }));
    await assertFails(deleteDoc(doc(dbFor(env, UID.admin), 'auditLog/a5')));
  });

  it('is readable only by admins', async () => {
    await seedDoc(env, 'auditLog/a6', auditDoc(UID.admin, 'admin'));
    await assertSucceeds(getDocs(collection(dbFor(env, UID.admin), 'auditLog')));
    for (const uid of [UID.operator, UID.purchase, UID.inward]) {
      await assertFails(getDocs(collection(dbFor(env, uid), 'auditLog')));
    }
  });
});

describe('PO number counter', () => {
  beforeEach(() => seedDoc(env, 'counters/orderSeq', { value: 7 }));

  it('lets an order creator take exactly the next number', async () => {
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.operator), 'counters/orderSeq'), { value: 8 }));
  });

  it('rejects skipping ahead — this is what makes duplicates impossible', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'counters/orderSeq'), { value: 9 }));
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'counters/orderSeq'), { value: 100 }));
  });

  it('rejects rewinding the counter, which would reissue a used PO number', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'counters/orderSeq'), { value: 6 }));
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'counters/orderSeq'), { value: 7 }));
  });

  it('stops roles that cannot create orders from consuming a number', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.purchase), 'counters/orderSeq'), { value: 8 }));
    await assertFails(updateDoc(doc(dbFor(env, UID.inward), 'counters/orderSeq'), { value: 8 }));
  });

  it('never allows deleting the counter', async () => {
    await assertFails(deleteDoc(doc(dbFor(env, UID.admin), 'counters/orderSeq')));
  });
});

describe('collections that do not exist', () => {
  it('denies reads and writes to anything outside the schema', async () => {
    await assertFails(setDoc(doc(dbFor(env, UID.admin), 'secrets/s1'), { x: 1 }));
    await assertFails(getDoc(doc(dbFor(env, UID.admin), 'secrets/s1')));
  });
});
