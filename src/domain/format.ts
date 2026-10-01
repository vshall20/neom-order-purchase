import type { Timestamp } from 'firebase/firestore';
import type { Order, OrderStatus } from '../types';
import { STATUS_LABELS } from '../types';

/** Random id for a form line. Not used for Firestore document ids. */
export function lineId(): string {
  return 'i' + Math.random().toString(36).slice(2, 10);
}

export function poNumberFor(seq: number, year: number): string {
  return 'PO-' + year + '-' + String(seq).padStart(4, '0');
}

export function fmtMoney(n: number | string | null | undefined): string {
  return (
    '₹' +
    (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Accepts a Firestore Timestamp, a Date, or an ISO string. */
export function fmtDate(d: Timestamp | Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d instanceof Date ? d : d.toDate();
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d: Timestamp | Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d instanceof Date ? d : d.toDate();
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "250 pcs", or just "250" when the item has no unit recorded. */
export function qtyWithUnit(item: { qty: number; unit?: string }): string {
  const unit = (item.unit ?? '').trim();
  return unit ? `${item.qty} ${unit}` : String(item.qty);
}

/**
 * Total quantity across an order's lines.
 *
 * Quantities only sum meaningfully when every line shares a unit — 10 kg plus
 * 4 box is not 14 of anything — so the unit is appended only when the order is
 * unambiguous, and dropped when it is mixed.
 */
export function totalQty(o: { items: readonly { qty: number; unit?: string }[] }): string {
  const total = o.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const units = new Set(o.items.map((it) => (it.unit ?? '').trim()).filter(Boolean));
  const allShareOneUnit = units.size === 1 && o.items.every((it) => (it.unit ?? '').trim());
  return allShareOneUnit ? `${total} ${[...units][0]}` : String(total);
}

export function orderTotal(o: Pick<Order, 'items'>): number {
  return o.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
}

/** 0..1 fraction of ordered quantity that has been received. */
export function orderReceivedFraction(o: Pick<Order, 'items'>): number {
  const total = o.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const received = o.items.reduce((s, it) => s + (Number(it.received) || 0), 0);
  return total === 0 ? 0 : received / total;
}

export function statusLabel(s: OrderStatus | string): string {
  return STATUS_LABELS[s as OrderStatus] ?? s;
}

export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * Dashboard "Material description" column: first two item names plus a
 * "+N more" tail. Deliberately shows materials rather than the vendor.
 */
export function materialDescription(o: Pick<Order, 'items'>): string {
  const names = (o.items ?? []).map((i) => i.name).filter(Boolean);
  if (names.length === 0) return '<span class="muted">No items</span>';
  const shown = names.slice(0, 2).join(', ');
  const extra = names.length > 2 ? ` +${names.length - 2} more` : '';
  return escapeHtml(shown) + (extra ? `<span class="muted">${escapeHtml(extra)}</span>` : '');
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
