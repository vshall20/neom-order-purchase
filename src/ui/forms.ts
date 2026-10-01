import { escapeHtml, fmtMoney } from '../domain/format';
import { findCatalogItem } from '../data/catalog';
import { state } from '../state';
import { pageHeader } from './chrome';
import { icon } from './icons';

/** True once a name has been typed that is not in the catalog yet. */
function isNewItem(name: string): boolean {
  return name.trim() !== '' && !findCatalogItem(state.catalog, name);
}

function unitHint(name: string): string {
  return isNewItem(name)
    ? 'New item — enter a unit so it is filed in the catalog correctly'
    : 'Filled in from the item catalog';
}

/** Datalist of active catalog items, shared by both item pickers. */
function catalogDatalist(): string {
  return `<datalist id="item-catalog-options">${state.catalog
    .filter((ci) => ci.active)
    .map((ci) => `<option value="${escapeHtml(ci.name)}"></option>`)
    .join('')}</datalist>`;
}

export function createView(): string {
  const f = state.createForm;
  const total = f.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  return `
    ${pageHeader('New order', 'Create purchase order', 'Add vendor details and line items, then save as draft or place immediately.')}
    <div class="form-panel">
      ${f.error ? `<div class="notice err">${escapeHtml(f.error)}</div>` : ''}
      <div class="form-row">
        <div class="field"><label>Vendor name</label>
          <input type="text" id="f-vendor" placeholder="Acme Supply Co." value="${escapeHtml(f.vendor)}"/></div>
        <div class="field" style="max-width:220px;"><label>Expected delivery</label>
          <input type="date" id="f-expected" value="${escapeHtml(f.expected)}"/></div>
      </div>
      <div class="items-head"><h3>Line items</h3></div>
      <div class="col-labels"><div>Item description</div><div>Qty</div><div>Unit</div><div>Unit price (₹)</div><div>Line total</div><div></div></div>
      ${f.items
        .map(
          (it) => `
        <div class="line-item">
          <input type="text" placeholder="Item name" list="item-catalog-options" value="${escapeHtml(it.name)}" data-line-field="name" data-line-id="${it.id}"/>
          <input type="number" inputmode="numeric" min="0" placeholder="Qty" aria-label="Quantity" value="${escapeHtml(it.qty)}" data-line-field="qty" data-line-id="${it.id}"/>
          <input type="text" placeholder="pcs / kg" aria-label="Unit of measure" title="${unitHint(it.name)}" value="${escapeHtml(it.unit)}" data-line-field="unit" data-line-id="${it.id}" class="${isNewItem(it.name) ? 'needs-unit' : ''}"/>
          <input type="number" inputmode="decimal" min="0" step="0.01" placeholder="Unit price ₹" aria-label="Unit price in rupees" value="${escapeHtml(it.price)}" data-line-field="price" data-line-id="${it.id}"/>
          <div class="line-total mono" id="lt-${it.id}">${fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0))}</div>
          <button class="remove-line" data-remove-line="${it.id}" title="Remove line">${icon('trash')}</button>
        </div>`,
        )
        .join('')}
      <button class="add-line-btn" id="add-line-btn">+ Add line item</button>
      ${catalogDatalist()}
      <div class="form-footer">
        <div class="order-total">Order total<span class="val mono" id="order-total-val">${fmtMoney(total)}</span></div>
        <div class="form-actions">
          <button class="btn btn-outline" id="save-draft-btn" ${state.busy ? 'disabled' : ''}>Save as draft</button>
          <button class="btn btn-primary" id="save-place-btn" ${state.busy ? 'disabled' : ''}>${icon('create')} Place order</button>
        </div>
      </div>
    </div>`;
}

export function requirementFormView(): string {
  const f = state.reqForm;
  const filled = f.items.filter((it) => it.name.trim()).length;

  return `
    ${pageHeader('New requirement', 'Place requirement', 'Submit the materials you need. A purchase manager will select a vendor and process the order.')}
    <div class="form-panel">
      <div class="notice">Requirements are submitted without vendor or pricing — that's assigned by the Purchase Manager during processing.</div>
      ${f.error ? `<div class="notice err">${escapeHtml(f.error)}</div>` : ''}
      <div class="form-row">
        <div class="field"><label>Note (optional)</label>
          <input type="text" id="req-note" placeholder="e.g. Needed for Line 2 production" value="${escapeHtml(f.note)}"/></div>
      </div>
      <div class="items-head"><h3>Materials needed</h3></div>
      <div class="col-labels no-price"><div>Item description</div><div>Quantity</div><div>Unit</div><div></div></div>
      ${f.items
        .map(
          (it) => `
        <div class="line-item no-price">
          <input type="text" placeholder="Item name" list="item-catalog-options" value="${escapeHtml(it.name)}" data-req-field="name" data-req-id="${it.id}"/>
          <input type="number" inputmode="numeric" min="0" placeholder="Qty" aria-label="Quantity" value="${escapeHtml(it.qty)}" data-req-field="qty" data-req-id="${it.id}"/>
          <input type="text" placeholder="pcs / kg" aria-label="Unit of measure" title="${unitHint(it.name)}" value="${escapeHtml(it.unit)}" data-req-field="unit" data-req-id="${it.id}" class="${isNewItem(it.name) ? 'needs-unit' : ''}"/>
          <button class="remove-line" data-remove-req-line="${it.id}" title="Remove line">${icon('trash')}</button>
        </div>`,
        )
        .join('')}
      <button class="add-line-btn" id="add-req-line-btn">+ Add material</button>
      ${catalogDatalist()}
      <div class="form-footer">
        <div class="muted">${filled} item(s) added</div>
        <div class="form-actions">
          <button class="btn btn-primary" id="submit-req-btn" ${state.busy ? 'disabled' : ''}>${icon('req')} Submit requirement</button>
        </div>
      </div>
    </div>`;
}
