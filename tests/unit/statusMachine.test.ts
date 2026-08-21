import { describe, expect, it } from 'vitest';
import {
  CREATABLE,
  TRANSITIONS,
  canCreateAs,
  canTransition,
  findTransition,
  statusAfterReceipt,
} from '../../src/domain/statusMachine';
import { APP_ROLES, ORDER_STATUSES, type AppRole, type OrderStatus } from '../../src/types';

describe('canTransition', () => {
  it('lets a purchase manager price a requirement and place it', () => {
    expect(canTransition('purchase_manager', 'requirement', 'pending')).toBe(true);
    expect(canTransition('admin', 'requirement', 'pending')).toBe(true);
  });

  it('does not let an operator place their own requirement', () => {
    expect(canTransition('operator', 'requirement', 'pending')).toBe(false);
  });

  it('does not let an inward manager price a requirement', () => {
    expect(canTransition('inward_manager', 'requirement', 'pending')).toBe(false);
  });

  it('lets only an admin place a draft', () => {
    expect(canTransition('admin', 'draft', 'pending')).toBe(true);
    for (const role of ['operator', 'purchase_manager', 'inward_manager'] as const) {
      expect(canTransition(role, 'draft', 'pending')).toBe(false);
    }
  });

  it('lets the inward manager record partial and full receipts', () => {
    expect(canTransition('inward_manager', 'pending', 'partial')).toBe(true);
    expect(canTransition('inward_manager', 'pending', 'received')).toBe(true);
    expect(canTransition('inward_manager', 'partial', 'partial')).toBe(true);
    expect(canTransition('inward_manager', 'partial', 'received')).toBe(true);
  });

  it('does not let the inward manager complete an order', () => {
    expect(canTransition('inward_manager', 'received', 'complete')).toBe(false);
    expect(canTransition('purchase_manager', 'received', 'complete')).toBe(true);
  });

  it('rejects the pending role for every transition', () => {
    for (const t of TRANSITIONS) {
      expect(canTransition('pending', t.from, t.to)).toBe(false);
    }
  });

  it('rejects transitions that skip a stage', () => {
    expect(canTransition('admin', 'requirement', 'complete')).toBe(false);
    expect(canTransition('admin', 'pending', 'complete')).toBe(false);
    expect(canTransition('admin', 'draft', 'received')).toBe(false);
  });

  it('rejects every transition not in the table, for every role', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (findTransition(from, to)) continue;
        for (const role of APP_ROLES) {
          expect(canTransition(role, from, to)).toBe(false);
        }
      }
    }
  });
});

describe('canCreateAs', () => {
  it('lets operators and admins raise a requirement', () => {
    expect(canCreateAs('operator', 'requirement')).toBe(true);
    expect(canCreateAs('admin', 'requirement')).toBe(true);
  });

  it('does not let an operator create a draft or a placed order', () => {
    expect(canCreateAs('operator', 'draft')).toBe(false);
    expect(canCreateAs('operator', 'pending')).toBe(false);
  });

  it('does not let anyone create an order mid-lifecycle', () => {
    for (const status of ['partial', 'received', 'complete'] as OrderStatus[]) {
      for (const role of APP_ROLES) {
        expect(canCreateAs(role, status)).toBe(false);
      }
    }
  });

  it('never lets a purchase or inward manager create an order directly', () => {
    for (const role of ['purchase_manager', 'inward_manager'] as AppRole[]) {
      for (const status of Object.keys(CREATABLE) as OrderStatus[]) {
        expect(canCreateAs(role, status)).toBe(false);
      }
    }
  });
});

describe('statusAfterReceipt', () => {
  it('is received once every line is fully in', () => {
    expect(
      statusAfterReceipt([{ qty: 5, received: 5 }, { qty: 2, received: 2 }], 'pending'),
    ).toBe('received');
  });

  it('is partial when only some has arrived', () => {
    expect(
      statusAfterReceipt([{ qty: 5, received: 3 }, { qty: 2, received: 0 }], 'pending'),
    ).toBe('partial');
  });

  it('holds the current status when nothing has arrived', () => {
    expect(
      statusAfterReceipt([{ qty: 5, received: 0 }, { qty: 2, received: 0 }], 'pending'),
    ).toBe('pending');
  });

  it('treats over-delivery on every line as fully received', () => {
    expect(statusAfterReceipt([{ qty: 5, received: 6 }], 'partial')).toBe('received');
  });

  it('treats a zero-quantity line as satisfied', () => {
    expect(
      statusAfterReceipt([{ qty: 0, received: 0 }, { qty: 3, received: 3 }], 'pending'),
    ).toBe('received');
  });
});
