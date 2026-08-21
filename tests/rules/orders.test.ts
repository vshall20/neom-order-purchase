import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UID, dbFor, makeTestEnv, orderDoc, seedDoc, seedProfiles } from './helpers';

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

describe('reading orders', () => {
  beforeEach(() => seedDoc(env, 'orders/o1', orderDoc()));

  it('denies a signed-out visitor', async () => {
    await assertFails(getDoc(doc(dbFor(env, null), 'orders/o1')));
  });

  it('denies a user whose role has not been assigned yet', async () => {
    await assertFails(getDoc(doc(dbFor(env, UID.pending), 'orders/o1')));
  });

  it('denies a deactivated user — this is how account removal works', async () => {
    await assertFails(getDoc(doc(dbFor(env, UID.disabled), 'orders/o1')));
  });

  it('allows every active role', async () => {
    for (const uid of [UID.admin, UID.operator, UID.purchase, UID.inward]) {
      await assertSucceeds(getDoc(doc(dbFor(env, uid), 'orders/o1')));
      await assertSucceeds(getDocs(collection(dbFor(env, uid), 'orders')));
    }
  });
});

describe('creating orders', () => {
  const requirement = (uid: string) =>
    orderDoc({
      status: 'requirement',
      vendor: '',
      vendorLower: '',
      total: 0,
      placedAt: null,
      items: [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 0, received: 0 }],
      createdBy: { uid, name: uid },
    });

  it('lets an operator raise a requirement', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(env, UID.operator), 'orders/new1'), requirement(UID.operator)),
    );
  });

  it('stops an operator from creating a placed order', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new2'),
        orderDoc({ createdBy: { uid: UID.operator, name: 'operator' } }),
      ),
    );
  });

  it('stops an operator from creating a draft', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new3'),
        orderDoc({ status: 'draft', createdBy: { uid: UID.operator, name: 'operator' } }),
      ),
    );
  });

  it('stops a requirement carrying a vendor or a price total', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new4'),
        { ...requirement(UID.operator), vendor: 'Acme' },
      ),
    );
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new5'),
        { ...requirement(UID.operator), total: 500 },
      ),
    );
  });

  it('stops anyone attributing an order to someone else', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new6'),
        { ...requirement(UID.operator), createdBy: { uid: UID.admin, name: 'admin' } },
      ),
    );
  });

  it('stops a back-dated createdAt', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.operator), 'orders/new7'),
        { ...requirement(UID.operator), createdAt: new Date('2020-01-01') },
      ),
    );
  });

  it('lets an admin create a draft and a placed order', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(env, UID.admin), 'orders/new8'), orderDoc({ status: 'draft', placedAt: null })),
    );
    await assertSucceeds(setDoc(doc(dbFor(env, UID.admin), 'orders/new9'), orderDoc()));
  });

  it('stops a purchase manager creating an order from nothing', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(env, UID.purchase), 'orders/new10'),
        orderDoc({ createdBy: { uid: UID.purchase, name: 'pm' } }),
      ),
    );
  });

  it('stops an order created straight into a mid-lifecycle status', async () => {
    for (const status of ['partial', 'received', 'complete']) {
      await assertFails(
        setDoc(doc(dbFor(env, UID.admin), `orders/mid-${status}`), orderDoc({ status })),
      );
    }
  });
});

describe('processing a requirement', () => {
  beforeEach(() =>
    seedDoc(
      env,
      'orders/req1',
      orderDoc({
        status: 'requirement',
        vendor: '',
        vendorLower: '',
        total: 0,
        placedAt: null,
        items: [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 0, received: 0 }],
        createdBy: { uid: UID.operator, name: 'operator' },
      }),
    ),
  );

  const priced = {
    status: 'pending',
    vendor: 'Acme Supply Co.',
    vendorLower: 'acme supply co.',
    items: [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 5, received: 0 }],
    total: 50,
    placedAt: serverTimestamp(),
    processedBy: { uid: UID.purchase, name: 'pm' },
  };

  it('lets a purchase manager price it and place it', async () => {
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.purchase), 'orders/req1'), priced));
  });

  it('lets an admin do the same', async () => {
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.admin), 'orders/req1'), priced));
  });

  it('stops the operator who raised it from placing it themselves', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.operator), 'orders/req1'), priced));
  });

  it('stops the inward manager from placing it', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.inward), 'orders/req1'), priced));
  });

  it('stops placing it with no vendor', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.purchase), 'orders/req1'), { ...priced, vendor: '', vendorLower: '' }),
    );
  });

  it('stops a requirement jumping straight to complete', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), 'orders/req1'), { status: 'complete' }),
    );
  });
});

describe('placing a draft', () => {
  beforeEach(() => seedDoc(env, 'orders/d1', orderDoc({ status: 'draft', placedAt: null })));

  it('lets an admin place it', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(env, UID.admin), 'orders/d1'), { status: 'pending', placedAt: serverTimestamp() }),
    );
  });

  it('stops a purchase manager placing an admin draft', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.purchase), 'orders/d1'), { status: 'pending', placedAt: serverTimestamp() }),
    );
  });
});

describe('receiving material', () => {
  const partly = [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 5, received: 4 }];
  const fully = [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 5, received: 10 }];

  beforeEach(() => seedDoc(env, 'orders/p1', orderDoc()));

  it('lets the inward manager log a partial receipt', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(env, UID.inward), 'orders/p1'), {
        items: partly,
        status: 'partial',
        receivedBy: { uid: UID.inward, name: 'inward' },
      }),
    );
  });

  it('lets the inward manager close it out as fully received', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(env, UID.inward), 'orders/p1'), {
        items: fully,
        status: 'received',
        receivedBy: { uid: UID.inward, name: 'inward' },
      }),
    );
  });

  it('stops a purchase manager recording receipts', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.purchase), 'orders/p1'), {
        items: partly,
        status: 'partial',
        receivedBy: { uid: UID.purchase, name: 'pm' },
      }),
    );
  });

  it('stops an operator recording receipts', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.operator), 'orders/p1'), {
        items: partly,
        status: 'partial',
        receivedBy: { uid: UID.operator, name: 'operator' },
      }),
    );
  });

  it('stops a receipt quietly repricing the order', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.inward), 'orders/p1'), {
        items: partly,
        status: 'partial',
        receivedBy: { uid: UID.inward, name: 'inward' },
        total: 1,
      }),
    );
  });

  it('stops a receipt switching the vendor', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.inward), 'orders/p1'), {
        items: partly,
        status: 'partial',
        receivedBy: { uid: UID.inward, name: 'inward' },
        vendor: 'Someone Else',
      }),
    );
  });

  it('stops the inward manager marking it complete', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.inward), 'orders/p1'), { items: fully, status: 'complete' }),
    );
  });
});

describe('completing an order', () => {
  beforeEach(() =>
    seedDoc(
      env,
      'orders/r1',
      orderDoc({
        status: 'received',
        items: [{ lineId: 'l1', name: 'Bolt', qty: 10, price: 5, received: 10 }],
      }),
    ),
  );

  const completion = (uid: string) => ({
    status: 'complete',
    completedBy: { uid, name: uid },
    completedAt: serverTimestamp(),
  });

  it('lets a purchase manager sign it off', async () => {
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.purchase), 'orders/r1'), completion(UID.purchase)));
  });

  it('lets an admin sign it off', async () => {
    await assertSucceeds(updateDoc(doc(dbFor(env, UID.admin), 'orders/r1'), completion(UID.admin)));
  });

  it('stops the inward manager signing it off', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.inward), 'orders/r1'), completion(UID.inward)));
  });

  it('stops the operator signing it off', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.operator), 'orders/r1'), completion(UID.operator)));
  });
});

describe('immutable fields', () => {
  beforeEach(() => seedDoc(env, 'orders/p1', orderDoc()));

  it('stops anyone rewriting the PO number', async () => {
    for (const uid of [UID.admin, UID.purchase, UID.inward, UID.operator]) {
      await assertFails(updateDoc(doc(dbFor(env, uid), 'orders/p1'), { poNumber: 'PO-2026-9999' }));
    }
  });

  it('stops anyone rewriting the sequence or the creator', async () => {
    await assertFails(updateDoc(doc(dbFor(env, UID.admin), 'orders/p1'), { poSeq: 99 }));
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), 'orders/p1'), { createdBy: { uid: UID.operator, name: 'x' } }),
    );
  });
});

describe('deletion', () => {
  beforeEach(() => seedDoc(env, 'orders/p1', orderDoc()));

  it('never allows a hard delete, not even for an admin', async () => {
    for (const uid of [UID.admin, UID.purchase, UID.inward, UID.operator]) {
      await assertFails(deleteDoc(doc(dbFor(env, uid), 'orders/p1')));
    }
  });

  it('lets an admin soft delete and then restore', async () => {
    const db = dbFor(env, UID.admin);
    await assertSucceeds(
      updateDoc(doc(db, 'orders/p1'), {
        deleted: true,
        deletedBy: { uid: UID.admin, name: 'admin' },
        deletedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'orders/p1'), { deleted: false, deletedBy: null, deletedAt: null }),
    );
  });

  it('stops non-admins soft deleting', async () => {
    for (const uid of [UID.purchase, UID.inward, UID.operator]) {
      await assertFails(
        updateDoc(doc(dbFor(env, uid), 'orders/p1'), {
          deleted: true,
          deletedBy: { uid, name: uid },
          deletedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('stops a delete being smuggled in alongside a status change', async () => {
    await assertFails(
      updateDoc(doc(dbFor(env, UID.admin), 'orders/p1'), { deleted: true, status: 'complete' }),
    );
  });
});

describe('the operator bypass the prototype allowed', () => {
  it('rejects an operator writing an order straight to complete', async () => {
    await seedDoc(env, 'orders/p1', orderDoc());
    // This is exactly what the prototype could not stop: it only checked
    // permissions in client JavaScript, which dev tools can walk around.
    await assertFails(
      updateDoc(doc(dbFor(env, UID.operator), 'orders/p1'), {
        status: 'complete',
        completedBy: { uid: UID.operator, name: 'operator' },
        completedAt: serverTimestamp(),
      }),
    );
    let statusAfter: unknown;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore() as never, 'orders/p1'));
      statusAfter = snap.data()?.status;
    });
    expect(statusAfter).toBe('pending');
  });
});
