import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  fmtDate,
  fmtMoney,
  materialDescription,
  orderReceivedFraction,
  orderTotal,
  poNumberFor,
  statusLabel,
} from '../../src/domain/format';
import { toDisplayLoginId, toSignInEmail } from '../../src/auth/loginId';

describe('poNumberFor', () => {
  it('pads the sequence to four digits', () => {
    expect(poNumberFor(1, 2026)).toBe('PO-2026-0001');
    expect(poNumberFor(42, 2026)).toBe('PO-2026-0042');
  });

  it('does not truncate past four digits', () => {
    expect(poNumberFor(12345, 2026)).toBe('PO-2026-12345');
  });
});

describe('fmtMoney', () => {
  it('always shows two decimals with a rupee sign', () => {
    expect(fmtMoney(1500)).toContain('1,500.00');
    expect(fmtMoney(1500)).toContain('₹');
  });

  it('treats null, undefined, and junk as zero', () => {
    for (const v of [null, undefined, 'abc']) {
      expect(fmtMoney(v as never)).toContain('0.00');
    }
  });
});

describe('fmtDate', () => {
  it('renders an em dash for a missing date', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
  });

  it('renders an em dash rather than "Invalid Date"', () => {
    expect(fmtDate('not a date')).toBe('—');
  });
});

describe('orderTotal', () => {
  it('sums qty times price across lines', () => {
    expect(
      orderTotal({
        items: [
          { lineId: 'a', name: 'x', qty: 2, price: 50, received: 0 },
          { lineId: 'b', name: 'y', qty: 3, price: 10, received: 0 },
        ],
      }),
    ).toBe(130);
  });

  it('is zero for an order with no lines', () => {
    expect(orderTotal({ items: [] })).toBe(0);
  });
});

describe('orderReceivedFraction', () => {
  it('is the received share of total quantity', () => {
    expect(
      orderReceivedFraction({
        items: [
          { lineId: 'a', name: 'x', qty: 4, price: 0, received: 2 },
          { lineId: 'b', name: 'y', qty: 6, price: 0, received: 3 },
        ],
      }),
    ).toBe(0.5);
  });

  it('does not divide by zero on an empty order', () => {
    expect(orderReceivedFraction({ items: [] })).toBe(0);
  });
});

describe('escapeHtml', () => {
  it('neutralises an injected script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes quotes so it is safe inside an attribute', () => {
    expect(escapeHtml(`" onerror="x`)).toBe('&quot; onerror=&quot;x');
  });
});

describe('materialDescription', () => {
  const item = (name: string) => ({ lineId: name, name, qty: 1, price: 0, received: 0 });

  it('lists the first two names and counts the rest', () => {
    const html = materialDescription({ items: ['Bolt', 'Nut', 'Washer', 'Screw'].map(item) });
    expect(html).toContain('Bolt, Nut');
    expect(html).toContain('+2 more');
  });

  it('says so when there are no items', () => {
    expect(materialDescription({ items: [] })).toContain('No items');
  });

  it('escapes item names', () => {
    expect(materialDescription({ items: [item('<b>x</b>')] })).toContain('&lt;b&gt;');
  });
});

describe('statusLabel', () => {
  it('gives every status a human label', () => {
    expect(statusLabel('requirement')).toBe('Requirement');
    expect(statusLabel('complete')).toBe('Complete');
  });

  it('falls back to the raw value for anything unrecognised', () => {
    expect(statusLabel('weird')).toBe('weird');
  });
});

describe('login id mapping', () => {
  it('appends the configured domain to a bare login id', () => {
    expect(toSignInEmail('ananya.r', 'neommodular.local')).toBe('ananya.r@neommodular.local');
  });

  it('leaves a real email address alone', () => {
    expect(toSignInEmail('Ananya@Neom.com', 'neommodular.local')).toBe('ananya@neom.com');
  });

  it('trims and lowercases what the user typed', () => {
    expect(toSignInEmail('  ADMIN  ', 'neommodular.local')).toBe('admin@neommodular.local');
  });

  it('returns empty for empty input rather than a bare domain', () => {
    expect(toSignInEmail('   ', 'neommodular.local')).toBe('');
  });

  it('round-trips back to the short login id for display', () => {
    expect(toDisplayLoginId('ananya.r@neommodular.local', 'neommodular.local')).toBe('ananya.r');
  });

  it('keeps a real address whole for display', () => {
    expect(toDisplayLoginId('ananya@neom.com', 'neommodular.local')).toBe('ananya@neom.com');
  });
});
