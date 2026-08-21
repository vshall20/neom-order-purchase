import { describe, expect, it } from 'vitest';
import { can, canSeeView, defaultViewFor } from '../../src/domain/permissions';
import { APP_ROLES, VIEWS, type View } from '../../src/types';

describe('canSeeView', () => {
  const expected: Record<string, View[]> = {
    admin: ['dashboard', 'create', 'requirements', 'pending', 'complete', 'catalog', 'users', 'activity'],
    operator: ['create'],
    purchase_manager: ['requirements', 'pending', 'complete', 'catalog'],
    inward_manager: ['dashboard', 'pending'],
  };

  for (const role of APP_ROLES) {
    it(`grants ${role} exactly its listed views and nothing else`, () => {
      for (const view of VIEWS) {
        expect(canSeeView(role, view)).toBe(expected[role]!.includes(view));
      }
    });
  }

  it('grants nothing to an unassigned or signed-out user', () => {
    for (const view of VIEWS) {
      expect(canSeeView('pending', view)).toBe(false);
      expect(canSeeView(null, view)).toBe(false);
      expect(canSeeView(undefined, view)).toBe(false);
    }
  });

  it('keeps the admin-only screens admin-only', () => {
    for (const role of ['operator', 'purchase_manager', 'inward_manager'] as const) {
      expect(canSeeView(role, 'users')).toBe(false);
      expect(canSeeView(role, 'activity')).toBe(false);
    }
  });
});

describe('can', () => {
  it('restricts full order creation and user management to admins', () => {
    expect(can('admin', 'createFullOrder')).toBe(true);
    expect(can('admin', 'manageUsers')).toBe(true);
    for (const role of ['operator', 'purchase_manager', 'inward_manager'] as const) {
      expect(can(role, 'createFullOrder')).toBe(false);
      expect(can(role, 'manageUsers')).toBe(false);
    }
  });

  it('restricts deleting, restoring, and reading the audit log to admins', () => {
    for (const action of ['deleteAnyOrder', 'restoreOrder', 'viewAudit'] as const) {
      expect(can('admin', action)).toBe(true);
      for (const role of ['operator', 'purchase_manager', 'inward_manager'] as const) {
        expect(can(role, action)).toBe(false);
      }
    }
  });

  it('gives each role the one job it owns', () => {
    expect(can('operator', 'submitRequirement')).toBe(true);
    expect(can('purchase_manager', 'processRequirement')).toBe(true);
    expect(can('inward_manager', 'receiveMaterial')).toBe(true);
    expect(can('purchase_manager', 'completeOrder')).toBe(true);
    expect(can('purchase_manager', 'manageCatalog')).toBe(true);
  });

  it('does not let roles do each other s jobs', () => {
    expect(can('operator', 'processRequirement')).toBe(false);
    expect(can('operator', 'receiveMaterial')).toBe(false);
    expect(can('inward_manager', 'completeOrder')).toBe(false);
    expect(can('inward_manager', 'manageCatalog')).toBe(false);
    expect(can('purchase_manager', 'receiveMaterial')).toBe(false);
  });

  it('grants nothing to an unassigned user', () => {
    expect(can('pending', 'submitRequirement')).toBe(false);
    expect(can(null, 'submitRequirement')).toBe(false);
  });
});

describe('defaultViewFor', () => {
  it('lands each role on a view it is allowed to see', () => {
    for (const role of APP_ROLES) {
      expect(canSeeView(role, defaultViewFor(role))).toBe(true);
    }
  });
});
