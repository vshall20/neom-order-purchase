import { escapeHtml, fmtMoney } from '../domain/format';
import type { Order } from '../types';
import { state } from '../state';

function findOrder(id: string | null): Order | undefined {
  if (!id) return undefined;
  return state.orders.find((o) => o.id === id);
}

/** Inward manager records what actually arrived. */
export function receiveDrawer(): string {
  const order = findOrder(state.receivingOrderId);
  if (!order) return '';

  return `
  <div class="overlay" id="drawer-overlay">
    <div class="drawer">
      <div class="drawer-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px;">Receiving</div>
          <h2>${escapeHtml(order.poNumber)}</h2>
          <div class="muted" style="margin-top:4px;">${escapeHtml(order.vendor)}</div>
        </div>
        <button class="close-btn" id="close-drawer">&times;</button>
      </div>
      ${state.receiveError ? `<div class="notice err" style="margin-top:16px;">${escapeHtml(state.receiveError)}</div>` : ''}
      <div class="drawer-label">Enter quantities received</div>
      ${order.items
        .map((it) => {
          const remaining = it.qty - it.received;
          const pct = it.qty === 0 ? 0 : Math.round((it.received / it.qty) * 100);
          return `
        <div class="receive-row">
          <div class="top">
            <div class="name">${escapeHtml(it.name)}</div>
            <div class="qty-info">${it.received} / ${it.qty} received</div>
          </div>
          <div class="fill-bar"><div class="fill" style="width:${pct}%;"></div></div>
          <div class="receive-input-row">
            <label>Receive now</label>
            <input type="number" min="0" max="${remaining}" placeholder="0"
                   value="${escapeHtml(state.receiveDraft[it.lineId] ?? '')}"
                   data-receive-id="${it.lineId}" ${remaining <= 0 ? 'disabled' : ''}/>
            <span class="muted" style="font-size:12px;">of ${remaining} remaining</span>
            ${remaining <= 0 ? '<span class="fully-tag">FULLY RECEIVED</span>' : ''}
          </div>
        </div>`;
        })
        .join('')}
      <div style="display:flex; gap:10px; margin-top:24px;">
        <button class="btn btn-outline" id="cancel-receive" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="submit-receive" style="flex:1;" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Saving…' : 'Confirm receipt'}</button>
      </div>
    </div>
  </div>`;
}

/** Purchase manager names a vendor and prices a requirement. */
export function processDrawer(): string {
  const order = findOrder(state.processingOrderId);
  if (!order) return '';

  const total = order.items.reduce(
    (s, it) => s + it.qty * (Number(state.processDraft.prices[it.lineId]) || 0),
    0,
  );

  return `
  <div class="overlay" id="process-overlay">
    <div class="drawer">
      <div class="drawer-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px;">Processing</div>
          <h2>${escapeHtml(order.poNumber)}</h2>
          <div class="muted" style="margin-top:4px;">Requested by ${escapeHtml(order.createdBy.name)}</div>
        </div>
        <button class="close-btn" id="close-process">&times;</button>
      </div>
      ${state.processError ? `<div class="notice err" style="margin-top:16px;">${escapeHtml(state.processError)}</div>` : ''}
      <div class="field" style="margin:20px 0 18px 0;">
        <label>Select vendor</label>
        <input type="text" id="proc-vendor" placeholder="Vendor name" value="${escapeHtml(state.processDraft.vendor)}"/>
      </div>
      <div class="drawer-label" style="margin-top:0;">Set unit price per item</div>
      ${order.items
        .map(
          (it) => `
        <div class="process-row">
          <div class="pname">${escapeHtml(it.name)}<div class="muted" style="font-weight:400;">Qty ${it.qty}</div></div>
          <div class="muted mono" style="text-align:center;">×${it.qty}</div>
          <input type="number" min="0" step="0.01" placeholder="Unit price ₹"
                 value="${escapeHtml(state.processDraft.prices[it.lineId] ?? '')}" data-proc-price-id="${it.lineId}"/>
          <div class="process-line-total" id="proc-lt-${it.lineId}">
            ${fmtMoney(it.qty * (Number(state.processDraft.prices[it.lineId]) || 0))}</div>
        </div>`,
        )
        .join('')}
      <div class="form-footer" style="border-top:1px solid var(--paper-line);">
        <div class="order-total">Order total<span class="val mono" id="proc-total-val">${fmtMoney(total)}</span></div>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button class="btn btn-outline" id="cancel-process" style="flex:1;">Cancel</button>
        <button class="btn btn-blue" id="submit-process" style="flex:1;" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? 'Placing…' : 'Confirm &amp; place order'}</button>
      </div>
    </div>
  </div>`;
}
