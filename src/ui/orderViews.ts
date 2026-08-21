import {
  escapeHtml,
  fmtDate,
  fmtMoney,
  materialDescription,
  orderReceivedFraction,
  orderTotal,
  statusLabel,
} from '../domain/format';
import { can } from '../domain/permissions';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../types';
import { state } from '../state';
import { emptyState, newOrderButton, pageHeader } from './chrome';
import { icon } from './icons';

/* ---------- shared bits ---------- */

const SEARCH_FIELDS = [
  { key: 'poNumber', label: 'PO number' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'item', label: 'Item (exact)' },
] as const;

/**
 * Search + status filter bar.
 *
 * Prefix search has to sort by the field being searched, so Firestore cannot
 * also apply a createdAt range at the same time. Rather than fail silently, the
 * bar says so while a search is active.
 */
export function searchBar(showStatusFilter: boolean): string {
  const searching = state.searchInput.trim().length > 0;
  const active = state.filter.statuses ?? [];
  return `
  <div class="list-controls">
    <div class="search-box">
      ${icon('search')}
      <input type="search" id="list-search" placeholder="Search…" value="${escapeHtml(state.searchInput)}"/>
      <select id="search-field">
        ${SEARCH_FIELDS.map(
          (f) => `<option value="${f.key}" ${state.searchField === f.key ? 'selected' : ''}>${f.label}</option>`,
        ).join('')}
      </select>
      ${searching ? '<button class="btn btn-sm btn-outline" id="clear-search">Clear</button>' : ''}
    </div>
    ${
      showStatusFilter
        ? `<div class="filter-chips">
            ${ORDER_STATUSES.map(
              (s) =>
                `<button class="chip ${active.includes(s) ? 'chip-on' : ''}" data-status-chip="${s}">${statusLabel(s)}</button>`,
            ).join('')}
          </div>`
        : ''
    }
    ${
      can(state.profile?.role, 'restoreOrder')
        ? `<label class="deleted-toggle">
             <input type="checkbox" id="show-deleted" ${state.filter.deleted ? 'checked' : ''}/>
             Show deleted
           </label>`
        : ''
    }
  </div>
  ${searching ? '<div class="notice subtle">Searching by prefix. Date filtering is unavailable while a search is active.</div>' : ''}
  ${state.listError ? `<div class="notice err">${escapeHtml(state.listError)}</div>` : ''}`;
}

export function pager(): string {
  const page = state.pageStack.length + 1;
  const hasPrev = state.pageStack.length > 0;
  const hasNext = state.nextCursor !== null;
  if (!hasPrev && !hasNext) return '';
  return `
  <div class="pager">
    <button class="btn btn-sm btn-outline" id="page-prev" ${hasPrev ? '' : 'disabled'}>Previous</button>
    <span class="muted mono">Page ${page}</span>
    <button class="btn btn-sm btn-outline" id="page-next" ${hasNext ? '' : 'disabled'}>Next</button>
  </div>`;
}

function deleteOrRestoreButton(o: Order): string {
  const role = state.profile?.role;
  if (o.deleted) {
    return can(role, 'restoreOrder')
      ? `<button class="btn btn-sm btn-outline" data-restore-order="${o.id}">${icon('restore')} Restore</button>`
      : '';
  }
  return can(role, 'deleteAnyOrder')
    ? `<button class="btn-ghost" data-delete-order="${o.id}" title="Delete order">${icon('trash')}</button>`
    : '';
}

function historyButton(o: Order): string {
  return can(state.profile?.role, 'viewAudit')
    ? `<button class="btn-ghost" data-order-history="${o.id}" title="Order history">${icon('activity')}</button>`
    : '';
}

export function orderRow(o: Order): string {
  const role = state.profile?.role;
  return `
    <tr class="${o.deleted ? 'row-deleted' : ''}">
      <td class="po-num">${escapeHtml(o.poNumber)}</td>
      <td class="vendor">${materialDescription(o)}</td>
      <td class="muted">${o.items.length} line${o.items.length !== 1 ? 's' : ''}</td>
      <td class="mono">${fmtMoney(orderTotal(o))}</td>
      <td><span class="stamp ${o.status}">${statusLabel(o.status)}</span>${o.deleted ? '<span class="stamp deleted-tag">Deleted</span>' : ''}</td>
      <td class="muted">${fmtDate(o.createdAt)}</td>
      <td class="row-actions">
        ${o.status === 'draft' && can(role, 'createFullOrder') ? `<button class="btn btn-sm btn-outline" data-place="${o.id}">Place order</button>` : ''}
        ${o.status === 'requirement' && can(role, 'processRequirement') ? `<button class="btn btn-sm btn-blue" data-process="${o.id}">Process</button>` : ''}
        ${(o.status === 'pending' || o.status === 'partial') && can(role, 'receiveMaterial') ? `<button class="btn btn-sm btn-outline" data-receive="${o.id}">Receive</button>` : ''}
        ${o.status === 'received' && can(role, 'completeOrder') ? `<button class="btn btn-sm btn-green" data-complete="${o.id}">Complete</button>` : ''}
        ${historyButton(o)}
        ${deleteOrRestoreButton(o)}
      </td>
    </tr>`;
}

const ORDER_TABLE_HEAD = `<thead><tr>
  <th>PO number</th><th>Material description</th><th>Items</th>
  <th>Total</th><th>Status</th><th>Created</th><th></th>
</tr></thead>`;

function orderTable(orders: Order[], emptyBig: string, emptySmall: string): string {
  if (orders.length === 0) return emptyState(emptyBig, emptySmall);
  return `<table>${ORDER_TABLE_HEAD}<tbody>${orders.map(orderRow).join('')}</tbody></table>`;
}

/* ---------- views ---------- */

export function dashboardView(): string {
  const c = state.counts;
  const tiles: { status: OrderStatus; label: string }[] = [
    { status: 'requirement', label: 'Requirement' },
    { status: 'pending', label: 'Pending' },
    { status: 'partial', label: 'Partial' },
    { status: 'received', label: 'Received' },
    { status: 'complete', label: 'Complete' },
  ];

  return `
    ${pageHeader('Overview', 'Order dashboard', 'Full visibility across every purchase order and its stage.', newOrderButton())}
    <div class="stats">
      ${tiles
        .map(
          (t) =>
            `<div class="stat-card c-${t.status}"><div class="num mono">${c[t.status] ?? '—'}</div><div class="label">${t.label}</div></div>`,
        )
        .join('')}
    </div>
    ${searchBar(true)}
    <div class="panel">
      ${orderTable(state.orders, 'No orders yet', 'Create your first purchase order to get started.')}
    </div>
    ${pager()}`;
}

export function requirementsQueueView(): string {
  const role = state.profile?.role;
  return `
    ${pageHeader('Procurement', 'Requirements queue', 'Requirements submitted by operators, awaiting vendor selection and pricing.')}
    ${searchBar(false)}
    <div class="panel">
      ${
        state.orders.length === 0
          ? emptyState('No open requirements', 'Requirements submitted by operators will appear here for processing.')
          : `<table><thead><tr><th>PO number</th><th>Requested items</th><th>Note</th><th>Submitted by</th><th>Date</th><th></th></tr></thead>
             <tbody>${state.orders
               .map(
                 (o) => `
               <tr class="${o.deleted ? 'row-deleted' : ''}">
                 <td class="po-num">${escapeHtml(o.poNumber)}</td>
                 <td>${o.items.map((it) => `${escapeHtml(it.name)} <span class="muted">×${it.qty}</span>`).join('<br/>')}</td>
                 <td class="muted">${o.note ? escapeHtml(o.note) : '—'}</td>
                 <td class="muted">${escapeHtml(o.createdBy.name)}</td>
                 <td class="muted">${fmtDate(o.createdAt)}</td>
                 <td class="row-actions">
                   ${can(role, 'processRequirement') && !o.deleted ? `<button class="btn btn-sm btn-blue" data-process="${o.id}">Process order</button>` : ''}
                   ${historyButton(o)}${deleteOrRestoreButton(o)}
                 </td>
               </tr>`,
               )
               .join('')}</tbody></table>`
      }
    </div>
    ${pager()}`;
}

export function pendingView(): string {
  const role = state.profile?.role;
  const drafts = state.orders.filter((o) => o.status === 'draft');
  const active = state.orders.filter((o) => o.status !== 'draft');

  return `
    ${pageHeader('Fulfillment', 'Pending orders', 'Orders awaiting delivery. Receive stock partially or in full as shipments arrive.', can(role, 'createFullOrder') ? newOrderButton() : '')}
    ${searchBar(false)}
    ${
      drafts.length
        ? `<div class="muted section-label">Drafts — not yet placed</div>
           <div class="panel" style="margin-bottom:24px;">
             <table><thead><tr><th>PO number</th><th>Vendor</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
             <tbody>${drafts
               .map(
                 (o) => `
               <tr>
                 <td class="po-num">${escapeHtml(o.poNumber)}</td><td class="vendor">${escapeHtml(o.vendor)}</td>
                 <td class="muted">${o.items.length} lines</td><td class="mono">${fmtMoney(orderTotal(o))}</td>
                 <td><span class="stamp draft">Draft</span></td>
                 <td class="row-actions">
                   <button class="btn btn-sm btn-primary" data-place="${o.id}">Place order</button>
                   ${historyButton(o)}${deleteOrRestoreButton(o)}
                 </td>
               </tr>`,
               )
               .join('')}</tbody></table>
           </div>`
        : ''
    }
    <div class="panel">
      ${
        active.length === 0
          ? emptyState('No active orders', 'Placed orders awaiting receipt will show up here.')
          : `<table><thead><tr><th>PO number</th><th>Vendor</th><th>Placed</th><th>Expected</th><th>Progress</th><th>Status</th><th></th></tr></thead>
             <tbody>${active
               .map((o) => {
                 const pct = Math.round(orderReceivedFraction(o) * 100);
                 return `
               <tr class="${o.deleted ? 'row-deleted' : ''}">
                 <td class="po-num">${escapeHtml(o.poNumber)}</td>
                 <td class="vendor">${escapeHtml(o.vendor)}</td>
                 <td class="muted">${fmtDate(o.placedAt)}</td>
                 <td class="muted">${fmtDate(o.expectedDate)}</td>
                 <td style="width:140px;">
                   <div class="fill-bar"><div class="fill" style="width:${pct}%;"></div></div>
                   <div class="muted mono" style="font-size:11px;">${pct}% received</div>
                 </td>
                 <td><span class="stamp ${o.status}">${statusLabel(o.status)}</span></td>
                 <td class="row-actions">
                   ${o.status !== 'received' && can(role, 'receiveMaterial') && !o.deleted ? `<button class="btn btn-sm btn-outline" data-receive="${o.id}">Receive</button>` : ''}
                   ${o.status === 'received' && can(role, 'completeOrder') && !o.deleted ? `<button class="btn btn-sm btn-green" data-complete="${o.id}">Complete</button>` : ''}
                   ${o.status === 'received' && !can(role, 'completeOrder') ? '<span class="muted">Awaiting completion</span>' : ''}
                   ${historyButton(o)}${deleteOrRestoreButton(o)}
                 </td>
               </tr>`;
               })
               .join('')}</tbody></table>`
      }
    </div>
    ${pager()}`;
}

export function completeView(): string {
  const role = state.profile?.role;
  return `
    ${pageHeader('Archive', 'Completed orders', 'Fully received orders. Mark received orders complete to close them out.')}
    ${searchBar(false)}
    <div class="panel">
      ${
        state.orders.length === 0
          ? emptyState('Nothing completed yet', 'Orders appear here once fully received and closed out.')
          : `<table><thead><tr><th>PO number</th><th>Vendor</th><th>Total</th><th>Placed</th><th>Status</th><th></th></tr></thead>
             <tbody>${state.orders
               .map(
                 (o) => `
               <tr class="${o.deleted ? 'row-deleted' : ''}">
                 <td class="po-num">${escapeHtml(o.poNumber)}</td><td class="vendor">${escapeHtml(o.vendor)}</td>
                 <td class="mono">${fmtMoney(orderTotal(o))}</td><td class="muted">${fmtDate(o.placedAt)}</td>
                 <td><span class="stamp ${o.status}">${statusLabel(o.status)}</span></td>
                 <td class="row-actions">
                   ${o.status === 'received' && can(role, 'completeOrder') && !o.deleted ? `<button class="btn btn-sm btn-green" data-complete="${o.id}">Mark complete</button>` : ''}
                   ${historyButton(o)}${deleteOrRestoreButton(o)}
                 </td>
               </tr>`,
               )
               .join('')}</tbody></table>`
      }
    </div>
    ${pager()}`;
}
