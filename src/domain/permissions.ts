import type { AppRole, Role, View } from '../types';

/**
 * Client-side permission checks.
 *
 * These drive the UI only — which nav items appear, which buttons render.
 * Every one of them is mirrored in `firestore.rules`, which is what actually
 * stops a user who opens dev tools. Never treat a check here as security.
 */

/** Views each role may open, ported from the prototype's `canSeeView`. */
const VIEW_ACCESS: Record<AppRole, readonly View[]> = {
  admin: ['dashboard', 'create', 'requirements', 'pending', 'complete', 'catalog', 'users', 'activity'],
  operator: ['create'],
  purchase_manager: ['requirements', 'pending', 'complete', 'catalog'],
  inward_manager: ['dashboard', 'pending'],
};

/** Landing view after sign-in, per role. */
export const DEFAULT_VIEW: Record<AppRole, View> = {
  admin: 'dashboard',
  operator: 'create',
  purchase_manager: 'requirements',
  inward_manager: 'pending',
};

export type Action =
  | 'createFullOrder'
  | 'submitRequirement'
  | 'processRequirement'
  | 'receiveMaterial'
  | 'completeOrder'
  | 'manageUsers'
  | 'manageCatalog'
  | 'deleteAnyOrder'
  | 'restoreOrder'
  | 'viewAudit';

const ACTION_ROLES: Record<Action, readonly AppRole[]> = {
  createFullOrder: ['admin'],
  submitRequirement: ['admin', 'operator'],
  processRequirement: ['admin', 'purchase_manager'],
  receiveMaterial: ['admin', 'inward_manager'],
  completeOrder: ['admin', 'purchase_manager'],
  manageUsers: ['admin'],
  manageCatalog: ['admin', 'purchase_manager'],
  deleteAnyOrder: ['admin'],
  restoreOrder: ['admin'],
  viewAudit: ['admin'],
};

function isAppRole(role: Role | null | undefined): role is AppRole {
  return role != null && role !== 'pending';
}

export function canSeeView(role: Role | null | undefined, view: View): boolean {
  if (!isAppRole(role)) return false;
  return VIEW_ACCESS[role].includes(view);
}

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!isAppRole(role)) return false;
  return ACTION_ROLES[action].includes(role);
}

export function defaultViewFor(role: Role | null | undefined): View {
  return isAppRole(role) ? DEFAULT_VIEW[role] : 'dashboard';
}
