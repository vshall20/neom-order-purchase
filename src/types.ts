import type { Timestamp } from 'firebase/firestore';

/* ---------- roles ---------- */

/** Roles that can actually use the app. */
export const APP_ROLES = ['admin', 'operator', 'purchase_manager', 'inward_manager'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * `pending` is the role a profile self-provisions with on first sign-in.
 * It grants nothing until an admin assigns a real role.
 */
export type Role = AppRole | 'pending';

export interface RoleMeta {
  label: string;
  short: string;
  desc: string;
}

export const ROLES: Record<AppRole, RoleMeta> = {
  admin: { label: 'Admin', short: 'Admin', desc: 'Full access to every module.' },
  operator: { label: 'Operator', short: 'Operator', desc: 'Can place material requirements.' },
  purchase_manager: {
    label: 'Purchase Manager',
    short: 'Purchase Mgr',
    desc: 'Selects vendor, processes and completes orders.',
  },
  inward_manager: {
    label: 'Inward Manager',
    short: 'Inward Mgr',
    desc: 'Checks pending orders and marks material received.',
  },
};

/* ---------- order lifecycle ---------- */

export const ORDER_STATUSES = [
  'requirement',
  'draft',
  'pending',
  'partial',
  'received',
  'complete',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  requirement: 'Requirement',
  draft: 'Draft',
  pending: 'Pending',
  partial: 'Partial',
  received: 'Received',
  complete: 'Complete',
};

/* ---------- documents ---------- */

/** Who performed an action. Denormalized so lists never need a join. */
export interface Actor {
  uid: string;
  name: string;
}

/** `users/{uid}` — uid is the Firebase Auth UID. Never contains a password. */
export interface UserProfile {
  uid: string;
  name: string;
  /** Local part of the sign-in email, or the full address if it is a real one. */
  loginId: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface OrderItem {
  lineId: string;
  name: string;
  qty: number;
  /**
   * Unit of measure, copied from the catalog when the item was added.
   * Snapshotted rather than looked up, so changing a catalog item's unit
   * later cannot rewrite history on orders already placed. Empty for items
   * that were not in the catalog at the time.
   */
  unit: string;
  /** Unit price in INR. Always 0 while the order is still a requirement. */
  price: number;
  /** Quantity received so far; drives partial/received status. */
  received: number;
}

/** `orders/{autoId}` */
export interface Order {
  id: string;
  poNumber: string;
  /** Monotonic sequence behind poNumber. Stable sort key. */
  poSeq: number;
  status: OrderStatus;
  vendor: string;
  /** Lowercased `vendor`, for prefix search. */
  vendorLower: string;
  note: string;
  items: OrderItem[];
  /** Lowercased item names, for `array-contains` search. */
  itemNames: string[];
  /** Sum of qty * price, computed on write so it can be sorted and filtered. */
  total: number;
  expectedDate: Timestamp | null;
  createdBy: Actor;
  createdAt: Timestamp | null;
  placedAt: Timestamp | null;
  processedBy: Actor | null;
  receivedBy: Actor | null;
  completedBy: Actor | null;
  completedAt: Timestamp | null;
  deleted: boolean;
  deletedBy: Actor | null;
  deletedAt: Timestamp | null;
}

/** `itemCatalog/{autoId}` */
export interface CatalogItem {
  id: string;
  name: string;
  nameLower: string;
  unit: string;
  defaultPrice: number;
  active: boolean;
  createdAt: Timestamp | null;
  createdBy: Actor | null;
}

/* ---------- audit ---------- */

export const AUDIT_ACTIONS = [
  'order.create',
  'order.submit_requirement',
  'order.place',
  'order.process',
  'order.receive',
  'order.complete',
  'order.delete',
  'order.restore',
  'user.role_change',
  'user.activate',
  'user.deactivate',
  'catalog.create',
  'catalog.enable',
  'catalog.disable',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTargetType = 'order' | 'user' | 'catalog';

/** `auditLog/{autoId}` — append-only; rules reject update and delete. */
export interface AuditEntry {
  id: string;
  at: Timestamp | null;
  actor: Actor & { role: Role };
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** Present when targetType is 'order', so the log reads without a join. */
  poNumber: string | null;
  summary: string;
  changes: Record<string, unknown>;
}

/* ---------- views ---------- */

export const VIEWS = [
  'dashboard',
  'create',
  'requirements',
  'pending',
  'complete',
  'catalog',
  'users',
  'activity',
] as const;
export type View = (typeof VIEWS)[number];
