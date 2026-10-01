import type { DocumentData, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import type {
  Actor,
  AuditEntry,
  CatalogItem,
  Order,
  OrderItem,
  OrderStatus,
  Role,
  UserProfile,
} from '../types';

/* Firestore documents are untyped at the wire. These readers normalize every
 * field so the rest of the app can rely on the interfaces in types.ts, even for
 * documents written before a field existed. */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const ts = (v: unknown): Timestamp | null =>
  v && typeof v === 'object' && 'toDate' in (v as object) ? (v as Timestamp) : null;

function actor(v: unknown): Actor | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { uid: str(o.uid), name: str(o.name) };
}

function requiredActor(v: unknown): Actor {
  return actor(v) ?? { uid: '', name: '—' };
}

function orderItem(v: unknown): OrderItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    lineId: str(o.lineId),
    name: str(o.name),
    qty: num(o.qty),
    unit: str(o.unit),
    price: num(o.price),
    received: num(o.received),
  };
}

export function toOrder(snap: QueryDocumentSnapshot<DocumentData>): Order {
  const d = snap.data();
  const items = Array.isArray(d.items) ? d.items.map(orderItem) : [];
  return {
    id: snap.id,
    poNumber: str(d.poNumber),
    poSeq: num(d.poSeq),
    status: str(d.status, 'draft') as OrderStatus,
    vendor: str(d.vendor),
    vendorLower: str(d.vendorLower),
    note: str(d.note),
    items,
    itemNames: Array.isArray(d.itemNames) ? d.itemNames.map((n) => str(n)) : [],
    total: num(d.total),
    expectedDate: ts(d.expectedDate),
    createdBy: requiredActor(d.createdBy),
    createdAt: ts(d.createdAt),
    placedAt: ts(d.placedAt),
    processedBy: actor(d.processedBy),
    receivedBy: actor(d.receivedBy),
    completedBy: actor(d.completedBy),
    completedAt: ts(d.completedAt),
    deleted: bool(d.deleted),
    deletedBy: actor(d.deletedBy),
    deletedAt: ts(d.deletedAt),
  };
}

export function toUserProfile(snap: QueryDocumentSnapshot<DocumentData>): UserProfile {
  const d = snap.data();
  return {
    uid: snap.id,
    name: str(d.name, '—'),
    loginId: str(d.loginId),
    email: str(d.email),
    role: str(d.role, 'pending') as Role,
    active: bool(d.active),
    createdAt: ts(d.createdAt),
    updatedAt: ts(d.updatedAt),
  };
}

export function toCatalogItem(snap: QueryDocumentSnapshot<DocumentData>): CatalogItem {
  const d = snap.data();
  return {
    id: snap.id,
    name: str(d.name),
    nameLower: str(d.nameLower),
    unit: str(d.unit),
    defaultPrice: num(d.defaultPrice),
    active: bool(d.active, true),
    createdAt: ts(d.createdAt),
    createdBy: actor(d.createdBy),
  };
}

export function toAuditEntry(snap: QueryDocumentSnapshot<DocumentData>): AuditEntry {
  const d = snap.data();
  const a = (d.actor ?? {}) as Record<string, unknown>;
  return {
    id: snap.id,
    at: ts(d.at),
    actor: { uid: str(a.uid), name: str(a.name, '—'), role: str(a.role, 'pending') as Role },
    action: str(d.action) as AuditEntry['action'],
    targetType: str(d.targetType, 'order') as AuditEntry['targetType'],
    targetId: str(d.targetId),
    poNumber: typeof d.poNumber === 'string' ? d.poNumber : null,
    summary: str(d.summary),
    changes: (d.changes ?? {}) as Record<string, unknown>,
  };
}
