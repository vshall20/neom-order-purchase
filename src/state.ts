import type { QueryDocumentSnapshot, Unsubscribe } from 'firebase/firestore';
import type {
  AuditEntry,
  CatalogItem,
  Order,
  OrderStatus,
  UserProfile,
  View,
} from './types';
import type { OrderFilter, SearchField, StatusCounts } from './data/queries';
import { lineId } from './domain/format';

/** A line being edited in the create-order form. Strings, because they are inputs. */
export interface FormLine {
  id: string;
  name: string;
  qty: string;
  price: string;
  /** Filled in from the catalog when the item name matches one. */
  unit: string;
}

export interface RequirementLine {
  id: string;
  name: string;
  qty: string;
  unit: string;
}

export type Phase = 'loading' | 'signed-out' | 'pending-approval' | 'ready';

export interface AppState {
  phase: Phase;
  /** Non-null whenever phase is 'ready' or 'pending-approval'. */
  profile: UserProfile | null;
  view: View;

  /* sign-in */
  loginId: string;
  loginPassword: string;
  loginError: string;
  loginBusy: boolean;

  /* live data */
  catalog: CatalogItem[];
  orders: Order[];
  counts: Partial<StatusCounts>;
  users: UserProfile[];
  audit: AuditEntry[];

  /* list controls */
  filter: OrderFilter;
  searchField: SearchField;
  searchInput: string;
  /** yyyy-mm-dd from the date inputs; empty means unbounded. */
  createdFrom: string;
  createdTo: string;
  /** Cursors for pages already visited; length is the current page index. */
  pageStack: QueryDocumentSnapshot[];
  nextCursor: QueryDocumentSnapshot | null;
  listError: string;

  /* forms */
  createForm: { vendor: string; expected: string; items: FormLine[]; error: string };
  reqForm: { note: string; items: RequirementLine[]; error: string };
  newItemForm: { name: string; unit: string; defaultPrice: string; error: string };

  /* drawers */
  receivingOrderId: string | null;
  receiveDraft: Record<string, string>;
  receiveError: string;
  processingOrderId: string | null;
  processDraft: { vendor: string; prices: Record<string, string> };
  processError: string;

  /* admin */
  auditTargetId: string | null;
  busy: boolean;

  /** Off-canvas navigation drawer, mobile only. */
  mobileNavOpen: boolean;
}

export function emptyCreateForm(): AppState['createForm'] {
  return {
    vendor: '',
    expected: '',
    items: [{ id: lineId(), name: '', qty: '', price: '', unit: '' }],
    error: '',
  };
}

export function emptyReqForm(): AppState['reqForm'] {
  return { note: '', items: [{ id: lineId(), name: '', qty: '', unit: '' }], error: '' };
}

export const state: AppState = {
  phase: 'loading',
  profile: null,
  view: 'dashboard',

  loginId: '',
  loginPassword: '',
  loginError: '',
  loginBusy: false,

  catalog: [],
  orders: [],
  counts: {},
  users: [],
  audit: [],

  filter: { deleted: false },
  searchField: 'poNumber',
  searchInput: '',
  createdFrom: '',
  createdTo: '',
  pageStack: [],
  nextCursor: null,
  listError: '',

  createForm: emptyCreateForm(),
  reqForm: emptyReqForm(),
  newItemForm: { name: '', unit: '', defaultPrice: '', error: '' },

  receivingOrderId: null,
  receiveDraft: {},
  receiveError: '',
  processingOrderId: null,
  processDraft: { vendor: '', prices: {} },
  processError: '',

  auditTargetId: null,
  busy: false,
  mobileNavOpen: false,
};

/* ---------- subscription bookkeeping ---------- */

const subscriptions = new Map<string, Unsubscribe>();

/**
 * Register a live listener under a key, tearing down any previous listener
 * with that key first. Every list rebuild goes through here, so switching
 * views or pages can never leak a Firestore listener.
 */
export function subscribe(key: string, start: () => Unsubscribe): void {
  subscriptions.get(key)?.();
  subscriptions.set(key, start());
}

export function unsubscribe(key: string): void {
  subscriptions.get(key)?.();
  subscriptions.delete(key);
}

export function unsubscribeAll(): void {
  for (const stop of subscriptions.values()) stop();
  subscriptions.clear();
}

/* ---------- list helpers ---------- */

/** Statuses each view lists, mirroring the prototype's per-screen filters. */
export const VIEW_STATUSES: Partial<Record<View, readonly OrderStatus[]>> = {
  requirements: ['requirement'],
  pending: ['pending', 'partial', 'received'],
  complete: ['complete', 'received'],
};

export function resetPaging(): void {
  state.pageStack = [];
  state.nextCursor = null;
}
