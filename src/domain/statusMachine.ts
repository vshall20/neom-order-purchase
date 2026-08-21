import type { AppRole, AuditAction, OrderStatus } from '../types';

/**
 * The order lifecycle, as a table of legal transitions and who may perform them.
 *
 * This mirrors `firestore.rules` exactly. The rules are the real enforcement
 * boundary — this table exists so the UI can hide actions a user cannot take,
 * and so the transitions are unit-testable without an emulator. If you change
 * one, change the other.
 */
export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  roles: readonly AppRole[];
  action: AuditAction;
  label: string;
}

export const TRANSITIONS: readonly Transition[] = [
  // Purchase manager (or admin) prices a requirement and places it with a vendor.
  {
    from: 'requirement',
    to: 'pending',
    roles: ['admin', 'purchase_manager'],
    action: 'order.process',
    label: 'Process order',
  },
  // Admin places a saved draft.
  {
    from: 'draft',
    to: 'pending',
    roles: ['admin'],
    action: 'order.place',
    label: 'Place order',
  },
  // Inward manager records receipts. Partial receipts can repeat.
  {
    from: 'pending',
    to: 'partial',
    roles: ['admin', 'inward_manager'],
    action: 'order.receive',
    label: 'Receive',
  },
  {
    from: 'pending',
    to: 'received',
    roles: ['admin', 'inward_manager'],
    action: 'order.receive',
    label: 'Receive',
  },
  {
    from: 'partial',
    to: 'partial',
    roles: ['admin', 'inward_manager'],
    action: 'order.receive',
    label: 'Receive',
  },
  {
    from: 'partial',
    to: 'received',
    roles: ['admin', 'inward_manager'],
    action: 'order.receive',
    label: 'Receive',
  },
  // Purchase manager (or admin) signs off a fully received order.
  {
    from: 'received',
    to: 'complete',
    roles: ['admin', 'purchase_manager'],
    action: 'order.complete',
    label: 'Complete',
  },
] as const;

/** Statuses an order may be created in, and who may create one there. */
export const CREATABLE: Readonly<Record<'requirement' | 'draft' | 'pending', readonly AppRole[]>> = {
  requirement: ['admin', 'operator'],
  draft: ['admin'],
  pending: ['admin'],
};

export function canCreateAs(role: AppRole | 'pending', status: OrderStatus): boolean {
  const allowed = (CREATABLE as Record<string, readonly AppRole[] | undefined>)[status];
  return !!allowed && allowed.includes(role as AppRole);
}

export function findTransition(from: OrderStatus, to: OrderStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(
  role: AppRole | 'pending',
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  const t = findTransition(from, to);
  return !!t && t.roles.includes(role as AppRole);
}

/**
 * Status an order lands in after a receipt, given the post-receipt items.
 * Full on every line -> received; anything received at all -> partial.
 */
export function statusAfterReceipt(
  items: readonly { qty: number; received: number }[],
  current: OrderStatus,
): OrderStatus {
  const full = items.every((it) => it.received >= it.qty);
  if (full) return 'received';
  const any = items.some((it) => it.received > 0);
  return any ? 'partial' : current;
}
