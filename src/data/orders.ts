import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Actor, Order, OrderItem, UserProfile } from '../types';
import { poNumberFor } from '../domain/format';
import { statusAfterReceipt } from '../domain/statusMachine';
import { toOrder } from './converters';
import { writeAudit } from './audit';

const ordersCol = () => collection(db, 'orders');
const counterRef = () => doc(db, 'counters', 'orderSeq');

function actorOf(user: UserProfile): Actor {
  return { uid: user.uid, name: user.name };
}

/** Item names, lowercased and de-duplicated, for `array-contains` search. */
function itemNamesOf(items: readonly OrderItem[]): string[] {
  return [...new Set(items.map((it) => it.name.trim().toLowerCase()).filter(Boolean))];
}

function totalOf(items: readonly OrderItem[]): number {
  return items.reduce((s, it) => s + it.qty * it.price, 0);
}

export interface NewOrderInput {
  vendor: string;
  expectedDate: Date | null;
  items: OrderItem[];
  /** true -> straight to `pending`; false -> saved as a `draft`. */
  placeImmediately: boolean;
}

/**
 * Create a full purchase order (admin only).
 *
 * Runs in a transaction that increments `counters/orderSeq` and writes the
 * order and its audit entry together. The security rule on the counter only
 * permits `value + 1`, so two people creating an order at the same moment can
 * never land on the same PO number — the loser retries and gets the next one.
 */
export async function createOrder(user: UserProfile, input: NewOrderInput): Promise<string> {
  const items = input.items;
  const orderRef = doc(ordersCol());

  await runTransaction(db, async (tx) => {
    const cRef = counterRef();
    const snap = await tx.get(cRef);
    const next = (snap.exists() ? (snap.data().value as number) : 0) + 1;
    if (snap.exists()) tx.update(cRef, { value: next });
    else tx.set(cRef, { value: next });

    const poNumber = poNumberFor(next, new Date().getFullYear());

    tx.set(orderRef, {
      poNumber,
      poSeq: next,
      status: input.placeImmediately ? 'pending' : 'draft',
      vendor: input.vendor.trim(),
      vendorLower: input.vendor.trim().toLowerCase(),
      note: '',
      items,
      itemNames: itemNamesOf(items),
      total: totalOf(items),
      expectedDate: input.expectedDate ? Timestamp.fromDate(input.expectedDate) : null,
      createdBy: actorOf(user),
      createdAt: serverTimestamp(),
      placedAt: input.placeImmediately ? serverTimestamp() : null,
      processedBy: null,
      receivedBy: null,
      completedBy: null,
      completedAt: null,
      deleted: false,
      deletedBy: null,
      deletedAt: null,
    });

    writeAudit(db, tx, user, {
      action: 'order.create',
      targetType: 'order',
      targetId: orderRef.id,
      poNumber,
      summary: `Created ${poNumber} for ${input.vendor.trim()}${
        input.placeImmediately ? ' and placed it' : ' as a draft'
      }`,
      changes: { status: input.placeImmediately ? 'pending' : 'draft', total: totalOf(items) },
    });
  });

  return orderRef.id;
}

export interface NewRequirementInput {
  note: string;
  /** Requirements carry no vendor and no pricing — price is always 0 here. */
  items: OrderItem[];
}

/** Submit a material requirement (operator or admin). No vendor, no pricing. */
export async function submitRequirement(
  user: UserProfile,
  input: NewRequirementInput,
): Promise<string> {
  const items = input.items.map((it) => ({ ...it, price: 0, received: 0 }));
  const orderRef = doc(ordersCol());

  await runTransaction(db, async (tx) => {
    const cRef = counterRef();
    const snap = await tx.get(cRef);
    const next = (snap.exists() ? (snap.data().value as number) : 0) + 1;
    if (snap.exists()) tx.update(cRef, { value: next });
    else tx.set(cRef, { value: next });

    const poNumber = poNumberFor(next, new Date().getFullYear());

    tx.set(orderRef, {
      poNumber,
      poSeq: next,
      status: 'requirement',
      vendor: '',
      vendorLower: '',
      note: input.note.trim(),
      items,
      itemNames: itemNamesOf(items),
      total: 0,
      expectedDate: null,
      createdBy: actorOf(user),
      createdAt: serverTimestamp(),
      placedAt: null,
      processedBy: null,
      receivedBy: null,
      completedBy: null,
      completedAt: null,
      deleted: false,
      deletedBy: null,
      deletedAt: null,
    });

    writeAudit(db, tx, user, {
      action: 'order.submit_requirement',
      targetType: 'order',
      targetId: orderRef.id,
      poNumber,
      summary: `Submitted requirement ${poNumber} (${items.length} item${items.length === 1 ? '' : 's'})`,
      changes: { items: items.map((i) => `${i.name} x${i.qty}`) },
    });
  });

  return orderRef.id;
}

/** Place a saved draft (admin). draft -> pending. */
export async function placeOrder(user: UserProfile, order: Order): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.id), {
    status: 'pending',
    placedAt: serverTimestamp(),
  });
  writeAudit(db, batch, user, {
    action: 'order.place',
    targetType: 'order',
    targetId: order.id,
    poNumber: order.poNumber,
    summary: `Placed ${order.poNumber} with ${order.vendor}`,
    changes: { status: { from: 'draft', to: 'pending' } },
  });
  await batch.commit();
}

/**
 * Price a requirement and place it with a vendor (purchase manager or admin).
 * requirement -> pending.
 */
export async function processRequirement(
  user: UserProfile,
  order: Order,
  vendor: string,
  prices: Record<string, number>,
): Promise<void> {
  const items = order.items.map((it) => ({ ...it, price: Number(prices[it.lineId]) || 0 }));
  const batch = writeBatch(db);

  batch.update(doc(db, 'orders', order.id), {
    status: 'pending',
    vendor: vendor.trim(),
    vendorLower: vendor.trim().toLowerCase(),
    items,
    total: totalOf(items),
    placedAt: serverTimestamp(),
    processedBy: actorOf(user),
  });
  writeAudit(db, batch, user, {
    action: 'order.process',
    targetType: 'order',
    targetId: order.id,
    poNumber: order.poNumber,
    summary: `Priced ${order.poNumber} and placed it with ${vendor.trim()}`,
    changes: { vendor: vendor.trim(), total: totalOf(items), status: { from: 'requirement', to: 'pending' } },
  });
  await batch.commit();
}

/**
 * Record a material receipt (inward manager or admin).
 *
 * Re-reads the order inside a transaction rather than trusting the copy on
 * screen, so two people receiving the same order at once both have their
 * quantities counted instead of one overwriting the other.
 */
export async function receiveMaterial(
  user: UserProfile,
  orderId: string,
  receipts: Record<string, number>,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'orders', orderId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('That order no longer exists.');

    const current = toOrder(snap as never);
    const items = current.items.map((it) => {
      const add = Number(receipts[it.lineId]) || 0;
      return { ...it, received: Math.min(it.qty, it.received + Math.max(0, add)) };
    });

    const added = items.reduce((s, it, i) => s + (it.received - (current.items[i]?.received ?? 0)), 0);
    if (added <= 0) throw new Error('Enter a quantity to receive.');

    const status = statusAfterReceipt(items, current.status);

    tx.update(ref, { items, status, receivedBy: actorOf(user) });
    writeAudit(db, tx, user, {
      action: 'order.receive',
      targetType: 'order',
      targetId: orderId,
      poNumber: current.poNumber,
      summary: `Received ${added} unit${added === 1 ? '' : 's'} against ${current.poNumber}`,
      changes: {
        received: items.map((it) => `${it.name}: ${it.received}/${it.qty}`),
        status: { from: current.status, to: status },
      },
    });
  });
}

/** Sign off a fully received order (purchase manager or admin). received -> complete. */
export async function completeOrder(user: UserProfile, order: Order): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.id), {
    status: 'complete',
    completedBy: actorOf(user),
    completedAt: serverTimestamp(),
  });
  writeAudit(db, batch, user, {
    action: 'order.complete',
    targetType: 'order',
    targetId: order.id,
    poNumber: order.poNumber,
    summary: `Closed out ${order.poNumber}`,
    changes: { status: { from: order.status, to: 'complete' } },
  });
  await batch.commit();
}

/**
 * Soft delete (admin only). The document is never removed — rules reject hard
 * deletes outright — so a deletion is always reversible and always auditable.
 */
export async function softDeleteOrder(user: UserProfile, order: Order): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.id), {
    deleted: true,
    deletedBy: actorOf(user),
    deletedAt: serverTimestamp(),
  });
  writeAudit(db, batch, user, {
    action: 'order.delete',
    targetType: 'order',
    targetId: order.id,
    poNumber: order.poNumber,
    summary: `Deleted ${order.poNumber}`,
    changes: { status: order.status, total: order.total },
  });
  await batch.commit();
}

/** Undo a soft delete (admin only). */
export async function restoreOrder(user: UserProfile, order: Order): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.id), {
    deleted: false,
    deletedBy: null,
    deletedAt: null,
  });
  writeAudit(db, batch, user, {
    action: 'order.restore',
    targetType: 'order',
    targetId: order.id,
    poNumber: order.poNumber,
    summary: `Restored ${order.poNumber}`,
    changes: {},
  });
  await batch.commit();
}

/** Live subscription to a single order, used by the receive and process drawers. */
export function watchOrder(id: string, cb: (order: Order | null) => void): () => void {
  return onSnapshot(doc(db, 'orders', id), (snap) => {
    cb(snap.exists() ? toOrder(snap as never) : null);
  });
}
