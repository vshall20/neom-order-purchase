import {
  collection,
  endAt,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  Timestamp,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AuditEntry, Order, OrderStatus } from '../types';
import { toAuditEntry, toOrder } from './converters';

export const PAGE_SIZE = 25;

/** High code point used as the upper bound of a prefix range query. */
const PREFIX_END = '';

export type SearchField = 'poNumber' | 'vendor' | 'item';

export interface OrderFilter {
  /** Restricted to these statuses when non-empty. */
  statuses?: readonly OrderStatus[];
  /** Defaults to false — deleted orders are hidden unless explicitly asked for. */
  deleted?: boolean;
  search?: { field: SearchField; value: string };
  createdFrom?: Date | null;
  createdTo?: Date | null;
}

/**
 * Translate a filter into Firestore query constraints.
 *
 * Firestore has no full-text search, so `poNumber` and `vendor` searches are
 * prefix matches and must be ordered by the field being searched. That means a
 * search cannot also carry a createdAt date range — Firestore only allows range
 * constraints on the field it is ordering by. When a search is active the date
 * range is dropped, and the UI says so.
 */
function orderConstraints(filter: OrderFilter): QueryConstraint[] {
  const c: QueryConstraint[] = [where('deleted', '==', filter.deleted ?? false)];

  if (filter.statuses && filter.statuses.length > 0) {
    c.push(where('status', 'in', [...filter.statuses]));
  }

  const term = filter.search?.value.trim().toLowerCase() ?? '';

  if (term && filter.search?.field === 'item') {
    // Exact item-name match; Firestore cannot prefix-match inside an array.
    c.push(where('itemNames', 'array-contains', term));
    c.push(orderBy('createdAt', 'desc'));
    return c;
  }

  if (term && filter.search?.field === 'poNumber') {
    const upper = filter.search.value.trim().toUpperCase();
    c.push(orderBy('poNumber'), startAt(upper), endAt(upper + PREFIX_END));
    return c;
  }

  if (term && filter.search?.field === 'vendor') {
    c.push(orderBy('vendorLower'), startAt(term), endAt(term + PREFIX_END));
    return c;
  }

  if (filter.createdFrom) c.push(where('createdAt', '>=', Timestamp.fromDate(filter.createdFrom)));
  if (filter.createdTo) c.push(where('createdAt', '<=', Timestamp.fromDate(filter.createdTo)));
  c.push(orderBy('createdAt', 'desc'));
  return c;
}

export interface OrderPage {
  orders: Order[];
  /** Cursor for the next page; null when this is the last page. */
  next: QueryDocumentSnapshot | null;
}

/**
 * Live subscription to one page of orders. Rebuilt whenever the filter or the
 * page cursor changes, so the visible page stays live while paging stays cheap.
 */
export function watchOrderPage(
  filter: OrderFilter,
  after: QueryDocumentSnapshot | null,
  cb: (page: OrderPage) => void,
  onError: (e: Error) => void,
  pageSize = PAGE_SIZE,
): Unsubscribe {
  const constraints = orderConstraints(filter);
  if (after) constraints.push(startAfter(after));
  // Fetch one extra row to learn whether a next page exists.
  constraints.push(limit(pageSize + 1));

  return onSnapshot(
    query(collection(db, 'orders'), ...constraints),
    (snap) => {
      const docs = snap.docs;
      const hasMore = docs.length > pageSize;
      const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
      cb({
        orders: pageDocs.map((d) => toOrder(d)),
        next: hasMore ? (pageDocs[pageDocs.length - 1] ?? null) : null,
      });
    },
    onError,
  );
}

/** One-shot fetch of the same query. Used where a live listener is overkill. */
export async function fetchOrders(filter: OrderFilter, max = PAGE_SIZE): Promise<Order[]> {
  const snap = await getDocs(
    query(collection(db, 'orders'), ...orderConstraints(filter), limit(max)),
  );
  return snap.docs.map((d) => toOrder(d));
}

export type StatusCounts = Record<OrderStatus, number>;

/**
 * Per-status counts for the dashboard tiles and sidebar badges.
 *
 * Uses server-side aggregation, so the client never downloads the orders just
 * to count them — the prototype's approach does not survive a few hundred rows.
 */
export async function countByStatus(statuses: readonly OrderStatus[]): Promise<Partial<StatusCounts>> {
  const entries = await Promise.all(
    statuses.map(async (status) => {
      const snap = await getCountFromServer(
        query(collection(db, 'orders'), where('deleted', '==', false), where('status', '==', status)),
      );
      return [status, snap.data().count] as const;
    }),
  );
  return Object.fromEntries(entries) as Partial<StatusCounts>;
}

export interface AuditFilter {
  targetId?: string;
  actorUid?: string;
  from?: Date | null;
  to?: Date | null;
}

/** Audit log page, newest first. Rules restrict reads to admins. */
export function watchAuditPage(
  filter: AuditFilter,
  after: QueryDocumentSnapshot | null,
  cb: (entries: AuditEntry[], next: QueryDocumentSnapshot | null) => void,
  onError: (e: Error) => void,
  pageSize = PAGE_SIZE,
): Unsubscribe {
  const c: QueryConstraint[] = [];
  if (filter.targetId) c.push(where('targetId', '==', filter.targetId));
  if (filter.actorUid) c.push(where('actor.uid', '==', filter.actorUid));
  if (filter.from) c.push(where('at', '>=', Timestamp.fromDate(filter.from)));
  if (filter.to) c.push(where('at', '<=', Timestamp.fromDate(filter.to)));
  c.push(orderBy('at', 'desc'));
  if (after) c.push(startAfter(after));
  c.push(limit(pageSize + 1));

  return onSnapshot(
    query(collection(db, 'auditLog'), ...c),
    (snap) => {
      const docs = snap.docs;
      const hasMore = docs.length > pageSize;
      const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
      cb(
        pageDocs.map((d) => toAuditEntry(d)),
        hasMore ? (pageDocs[pageDocs.length - 1] ?? null) : null,
      );
    },
    onError,
  );
}
