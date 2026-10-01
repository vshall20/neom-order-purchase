import {
  addCatalogItem,
  ensureCatalogEntries,
  findCatalogItem,
  setCatalogActive,
} from '../data/catalog';
import {
  completeOrder,
  createOrder,
  placeOrder,
  processRequirement,
  receiveMaterial,
  restoreOrder,
  softDeleteOrder,
  submitRequirement,
} from '../data/orders';
import { setUserActive, setUserName, setUserRole } from '../data/users';
import { signIn, signInErrorMessage, signOut } from '../auth/session';
import { fmtMoney, lineId } from '../domain/format';
import { can } from '../domain/permissions';
import { APP_ROLES, type AppRole, type Order, type OrderItem, type OrderStatus, type View } from '../types';
import {
  emptyCreateForm,
  emptyReqForm,
  resetPaging,
  state,
  type FormLine,
  type RequirementLine,
} from '../state';
import { render } from './render';
import { refreshCounts, syncAuditList, syncOrderList, syncViewSubscriptions } from './subscriptions';
import { errorToast, toast } from './toast';

/* ---------- small helpers ---------- */

function el<T extends Element>(target: EventTarget | null, selector: string): T | null {
  if (!(target instanceof Element)) return null;
  return target.closest<T>(selector);
}

function findOrder(id: string): Order | undefined {
  return state.orders.find((o) => o.id === id);
}

/** Wraps a mutation so the button disables, errors surface, and counts refresh. */
async function run(work: () => Promise<void>, fallbackMessage: string): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await work();
    void refreshCounts();
  } catch (e) {
    errorToast(e, fallbackMessage);
  } finally {
    state.busy = false;
    render();
  }
}

function setView(view: View): void {
  // Always close the mobile drawer, even when re-selecting the current view —
  // otherwise tapping the active item leaves the drawer covering the screen.
  state.mobileNavOpen = false;
  if (state.view === view) {
    render();
    return;
  }
  state.view = view;
  state.listError = '';
  state.auditTargetId = null;
  resetPaging();
  syncViewSubscriptions();
  render();
}

/* ---------- create-order form ---------- */

/** Live line and order totals, updated without a re-render so typing is smooth. */
function updateCreateTotals(): void {
  let total = 0;
  for (const it of state.createForm.items) {
    const lineTotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
    total += lineTotal;
    const cell = document.getElementById('lt-' + it.id);
    if (cell) cell.textContent = fmtMoney(lineTotal);
  }
  const totalCell = document.getElementById('order-total-val');
  if (totalCell) totalCell.textContent = fmtMoney(total);
}

function updateProcessTotals(): void {
  const order = state.processingOrderId ? findOrder(state.processingOrderId) : undefined;
  if (!order) return;
  let total = 0;
  for (const it of order.items) {
    const lineTotal = it.qty * (Number(state.processDraft.prices[it.lineId]) || 0);
    total += lineTotal;
    const cell = document.getElementById('proc-lt-' + it.lineId);
    if (cell) cell.textContent = fmtMoney(lineTotal);
  }
  const totalCell = document.getElementById('proc-total-val');
  if (totalCell) totalCell.textContent = fmtMoney(total);
}

/**
 * Reconcile a line's unit with the catalog after its name changed.
 *
 * A catalog match dictates the unit. Moving to a name that is not in the
 * catalog clears a unit that came from the catalog — otherwise the previous
 * item's unit silently rides along onto a different material — but keeps one
 * the user typed themselves.
 */
function applyCatalogUnit(
  line: { name: string; unit: string; unitFromCatalog: boolean },
  typedName: string,
): void {
  const match = findCatalogItem(state.catalog, typedName);
  if (match) {
    line.unit = match.unit;
    line.unitFromCatalog = true;
  } else if (line.unitFromCatalog) {
    line.unit = '';
    line.unitFromCatalog = false;
  }
}

/**
 * Push a line's unit into the DOM without a re-render, and flag it when the
 * item is new. Re-rendering mid-keystroke would be the obvious alternative,
 * but it fights the user's cursor on every character typed.
 */
function syncUnitInput(
  line: { id: string; name: string; unit: string; unitFromCatalog: boolean },
  kind: 'line' | 'req',
): void {
  const selector =
    kind === 'line'
      ? `[data-line-field="unit"][data-line-id="${CSS.escape(line.id)}"]`
      : `[data-req-field="unit"][data-req-id="${CSS.escape(line.id)}"]`;
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) return;
  input.value = line.unit;
  input.classList.toggle('needs-unit', line.name.trim() !== '' && !line.unitFromCatalog);
}

/** Named lines that were left without a unit. */
function linesMissingUnit(
  lines: readonly { name: string; unit: string }[],
): string[] {
  return lines.filter((it) => it.name.trim() !== '' && it.unit.trim() === '').map((it) => it.name.trim());
}

/** Line items ready for Firestore: named lines only, numbers coerced. */
function toOrderItems(lines: readonly FormLine[]): OrderItem[] {
  return lines
    .filter((it) => it.name.trim() !== '')
    .map((it) => ({
      lineId: it.id,
      name: it.name.trim(),
      qty: Number(it.qty) || 0,
      unit: it.unit.trim(),
      price: Number(it.price) || 0,
      received: 0,
    }));
}

function toRequirementItems(lines: readonly RequirementLine[]): OrderItem[] {
  return lines
    .filter((it) => it.name.trim() !== '')
    .map((it) => ({
      lineId: it.id,
      name: it.name.trim(),
      qty: Number(it.qty) || 0,
      unit: it.unit.trim(),
      price: 0,
      received: 0,
    }));
}

/** Tell the user when ordering an item also filed it in the catalog. */
function reportNewCatalogItems(added: readonly string[]): void {
  if (added.length === 0) return;
  // The unit and price are captured on the line now, so the entry arrives
  // complete and there is nothing for the user to go and fix.
  toast(
    added.length === 1
      ? `"${added[0]}" added to the item catalog.`
      : `${added.length} new items added to the item catalog.`,
  );
}

async function submitCreateOrder(placeImmediately: boolean): Promise<void> {
  const profile = state.profile;
  if (!profile) return;
  const f = state.createForm;
  const items = toOrderItems(f.items);

  const missingUnit = linesMissingUnit(f.items);

  f.error = '';
  if (!f.vendor.trim()) f.error = 'Enter a vendor name.';
  else if (items.length === 0) f.error = 'Add at least one line item.';
  else if (missingUnit.length > 0) {
    f.error = `Enter a unit (pcs, kg, box…) for ${missingUnit.join(', ')}. New items need one so they are filed in the catalog correctly.`;
  }
  if (f.error) {
    render();
    return;
  }

  await run(async () => {
    await createOrder(profile, {
      vendor: f.vendor,
      expectedDate: f.expected ? new Date(f.expected) : null,
      items,
      placeImmediately,
    });
    void reportNewCatalogItems(await ensureCatalogEntries(profile, state.catalog, items));
    state.createForm = emptyCreateForm();
    state.view = placeImmediately ? 'pending' : 'dashboard';
    resetPaging();
    syncViewSubscriptions();
    toast(placeImmediately ? 'Order placed.' : 'Saved as a draft.');
  }, 'Could not create the order.');
}

async function submitRequirementForm(): Promise<void> {
  const profile = state.profile;
  if (!profile) return;
  const f = state.reqForm;
  const items = toRequirementItems(f.items);

  const missingUnit = linesMissingUnit(f.items);

  f.error = '';
  if (items.length === 0) f.error = 'Add at least one material.';
  else if (missingUnit.length > 0) {
    f.error = `Enter a unit (pcs, kg, box…) for ${missingUnit.join(', ')}. New items need one so they are filed in the catalog correctly.`;
  }
  if (f.error) {
    render();
    return;
  }

  await run(async () => {
    await submitRequirement(profile, { note: f.note, items });
    void reportNewCatalogItems(await ensureCatalogEntries(profile, state.catalog, items));
    state.reqForm = emptyReqForm();
    toast('Requirement submitted. A purchase manager will price it.');
  }, 'Could not submit the requirement.');
}

/* ---------- drawers ---------- */

function openReceive(id: string): void {
  const order = findOrder(id);
  if (!order || !can(state.profile?.role, 'receiveMaterial')) return;
  state.receivingOrderId = id;
  state.receiveDraft = {};
  state.receiveError = '';
  render();
}

function closeReceive(): void {
  state.receivingOrderId = null;
  state.receiveDraft = {};
  state.receiveError = '';
  render();
}

async function submitReceiveDrawer(): Promise<void> {
  const profile = state.profile;
  const id = state.receivingOrderId;
  if (!profile || !id) return;

  const receipts: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.receiveDraft)) {
    const n = Number(value);
    if (n > 0) receipts[key] = n;
  }
  if (Object.keys(receipts).length === 0) {
    state.receiveError = 'Enter at least one quantity to receive.';
    render();
    return;
  }

  await run(async () => {
    await receiveMaterial(profile, id, receipts);
    closeReceive();
    toast('Receipt recorded.');
  }, 'Could not record the receipt.');
}

function openProcess(id: string): void {
  const order = findOrder(id);
  if (!order || !can(state.profile?.role, 'processRequirement')) return;
  state.processingOrderId = id;
  state.processError = '';
  // Pre-fill each line from the catalog's default price, as the prototype did.
  const prices: Record<string, string> = {};
  for (const it of order.items) {
    const match = findCatalogItem(state.catalog, it.name);
    prices[it.lineId] = match ? String(match.defaultPrice) : '';
  }
  state.processDraft = { vendor: '', prices };
  render();
}

function closeProcess(): void {
  state.processingOrderId = null;
  state.processDraft = { vendor: '', prices: {} };
  state.processError = '';
  render();
}

async function submitProcessDrawer(): Promise<void> {
  const profile = state.profile;
  const id = state.processingOrderId;
  if (!profile || !id) return;
  const order = findOrder(id);
  if (!order) return;

  if (!state.processDraft.vendor.trim()) {
    state.processError = 'Enter a vendor before placing the order.';
    render();
    return;
  }

  const prices: Record<string, number> = {};
  for (const it of order.items) prices[it.lineId] = Number(state.processDraft.prices[it.lineId]) || 0;

  // Captured before closeProcess() clears the draft.
  const vendor = state.processDraft.vendor.trim();

  await run(async () => {
    await processRequirement(profile, order, vendor, prices);
    closeProcess();
    state.view = 'pending';
    resetPaging();
    syncViewSubscriptions();
    toast(`${order.poNumber} placed with ${vendor}.`);
  }, 'Could not place the order.');
}

/* ---------- soft delete ---------- */

async function deleteWithUndo(order: Order): Promise<void> {
  const profile = state.profile;
  if (!profile) return;

  await run(async () => {
    await softDeleteOrder(profile, order);
    toast(`${order.poNumber} deleted.`, {
      action: {
        label: 'Undo',
        run: () =>
          run(async () => {
            await restoreOrder(profile, order);
            toast(`${order.poNumber} restored.`);
          }, 'Could not restore the order.'),
      },
    });
  }, 'Could not delete the order.');
}

/* ---------- search and paging ---------- */

let searchTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSearch(): void {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    resetPaging();
    syncOrderList();
  }, 300);
}

function toggleStatusChip(status: OrderStatus): void {
  const current = state.filter.statuses ? [...state.filter.statuses] : [];
  const next = current.includes(status)
    ? current.filter((s) => s !== status)
    : [...current, status];
  const filter = { ...state.filter };
  if (next.length) filter.statuses = next;
  else delete filter.statuses;
  state.filter = filter;
  resetPaging();
  syncOrderList();
  render();
}

/* ---------- event delegation ---------- */

async function onClick(event: MouseEvent): Promise<void> {
  const t = event.target;
  const profile = state.profile;

  /* sign in / out — available in every phase */
  if (el(t, '#signin-btn')) {
    state.loginBusy = true;
    state.loginError = '';
    render();
    try {
      await signIn(state.loginId, state.loginPassword);
    } catch (e) {
      state.loginError = e instanceof Error && e.message.startsWith('Enter your')
        ? e.message
        : signInErrorMessage(e);
    } finally {
      state.loginBusy = false;
      state.loginPassword = '';
      render();
    }
    return;
  }
  if (el(t, '#signout-btn')) {
    await signOut();
    return;
  }

  if (!profile) return;

  /* mobile navigation drawer */
  if (el(t, '#mobile-nav-toggle')) {
    state.mobileNavOpen = !state.mobileNavOpen;
    render();
    return;
  }
  if (el(t, '#nav-backdrop')) {
    state.mobileNavOpen = false;
    render();
    return;
  }

  /* navigation */
  const nav = el<HTMLElement>(t, '[data-nav]');
  if (nav?.dataset.nav) {
    setView(nav.dataset.nav as View);
    return;
  }

  /* search and filters */
  if (el(t, '#clear-dates')) {
    state.createdFrom = '';
    state.createdTo = '';
    resetPaging();
    syncOrderList();
    render();
    return;
  }
  if (el(t, '#clear-search')) {
    state.searchInput = '';
    resetPaging();
    syncOrderList();
    render();
    return;
  }
  const chip = el<HTMLElement>(t, '[data-status-chip]');
  if (chip?.dataset.statusChip) {
    toggleStatusChip(chip.dataset.statusChip as OrderStatus);
    return;
  }

  /* paging */
  if (el(t, '#page-next')) {
    if (state.nextCursor) {
      state.pageStack.push(state.nextCursor);
      syncOrderList();
      render();
    }
    return;
  }
  if (el(t, '#page-prev')) {
    state.pageStack.pop();
    syncOrderList();
    render();
    return;
  }

  /* order row actions */
  const place = el<HTMLElement>(t, '[data-place]');
  if (place?.dataset.place) {
    const order = findOrder(place.dataset.place);
    if (order) await run(() => placeOrder(profile, order), 'Could not place the order.');
    return;
  }
  const process = el<HTMLElement>(t, '[data-process]');
  if (process?.dataset.process) {
    openProcess(process.dataset.process);
    return;
  }
  const receive = el<HTMLElement>(t, '[data-receive]');
  if (receive?.dataset.receive) {
    openReceive(receive.dataset.receive);
    return;
  }
  const complete = el<HTMLElement>(t, '[data-complete]');
  if (complete?.dataset.complete) {
    const order = findOrder(complete.dataset.complete);
    if (order) await run(() => completeOrder(profile, order), 'Could not complete the order.');
    return;
  }
  const del = el<HTMLElement>(t, '[data-delete-order]');
  if (del?.dataset.deleteOrder) {
    const order = findOrder(del.dataset.deleteOrder);
    if (order) await deleteWithUndo(order);
    return;
  }
  const restore = el<HTMLElement>(t, '[data-restore-order]');
  if (restore?.dataset.restoreOrder) {
    const order = findOrder(restore.dataset.restoreOrder);
    if (order) await run(() => restoreOrder(profile, order), 'Could not restore the order.');
    return;
  }
  const history = el<HTMLElement>(t, '[data-order-history]');
  if (history?.dataset.orderHistory) {
    state.auditTargetId = history.dataset.orderHistory;
    state.view = 'activity';
    syncViewSubscriptions();
    render();
    return;
  }
  if (el(t, '#clear-audit-scope')) {
    state.auditTargetId = null;
    syncAuditList();
    render();
    return;
  }

  /* create-order form */
  if (el(t, '#add-line-btn')) {
    state.createForm.items.push({ id: lineId(), name: '', qty: '', price: '', unit: '', unitFromCatalog: false });
    render();
    return;
  }
  const removeLine = el<HTMLElement>(t, '[data-remove-line]');
  if (removeLine?.dataset.removeLine) {
    if (state.createForm.items.length > 1) {
      const id = removeLine.dataset.removeLine;
      state.createForm.items = state.createForm.items.filter((it) => it.id !== id);
      render();
    }
    return;
  }
  if (el(t, '#save-draft-btn')) return submitCreateOrder(false);
  if (el(t, '#save-place-btn')) return submitCreateOrder(true);

  /* requirement form */
  if (el(t, '#add-req-line-btn')) {
    state.reqForm.items.push({ id: lineId(), name: '', qty: '', unit: '', unitFromCatalog: false });
    render();
    return;
  }
  const removeReq = el<HTMLElement>(t, '[data-remove-req-line]');
  if (removeReq?.dataset.removeReqLine) {
    if (state.reqForm.items.length > 1) {
      const id = removeReq.dataset.removeReqLine;
      state.reqForm.items = state.reqForm.items.filter((it) => it.id !== id);
      render();
    }
    return;
  }
  if (el(t, '#submit-req-btn')) return submitRequirementForm();

  /* catalog */
  if (el(t, '#add-item-btn')) {
    const f = state.newItemForm;
    f.error = '';
    if (!f.name.trim()) f.error = 'Item description is required.';
    else if (state.catalog.some((ci) => ci.nameLower === f.name.trim().toLowerCase()))
      f.error = 'This item already exists in the catalog.';
    if (f.error) {
      render();
      return;
    }
    await run(async () => {
      await addCatalogItem(profile, {
        name: f.name,
        unit: f.unit,
        defaultPrice: Number(f.defaultPrice) || 0,
      });
      state.newItemForm = { name: '', unit: '', defaultPrice: '', error: '' };
    }, 'Could not add the catalog item.');
    return;
  }
  const toggleItem = el<HTMLElement>(t, '[data-toggle-item]');
  if (toggleItem?.dataset.toggleItem) {
    const id = toggleItem.dataset.toggleItem;
    const item = state.catalog.find((ci) => ci.id === id);
    if (item) await run(() => setCatalogActive(profile, item, !item.active), 'Could not update the item.');
    return;
  }

  /* users */
  const toggleUser = el<HTMLElement>(t, '[data-toggle-user]');
  if (toggleUser?.dataset.toggleUser) {
    const id = toggleUser.dataset.toggleUser;
    const target = state.users.find((u) => u.uid === id);
    if (target) {
      await run(() => setUserActive(profile, target, !target.active), 'Could not update the account.');
    }
    return;
  }

  /* drawers */
  if (el(t, '#close-drawer') || el(t, '#cancel-receive')) {
    closeReceive();
    return;
  }
  if (el(t, '#submit-receive')) return submitReceiveDrawer();
  if (el(t, '#close-process') || el(t, '#cancel-process')) {
    closeProcess();
    return;
  }
  if (el(t, '#submit-process')) return submitProcessDrawer();

  // Clicking the dimmed backdrop closes the drawer.
  if (t instanceof Element && t.id === 'drawer-overlay') closeReceive();
  if (t instanceof Element && t.id === 'process-overlay') closeProcess();
}

function onInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const value = target.value;

  switch (target.id) {
    case 'login-username':
      state.loginId = value;
      return;
    case 'login-password':
      state.loginPassword = value;
      return;
    case 'f-vendor':
      state.createForm.vendor = value;
      return;
    case 'f-expected':
      state.createForm.expected = value;
      return;
    case 'req-note':
      state.reqForm.note = value;
      return;
    case 'ci-name':
      state.newItemForm.name = value;
      return;
    case 'ci-unit':
      state.newItemForm.unit = value;
      return;
    case 'ci-price':
      state.newItemForm.defaultPrice = value;
      return;
    case 'proc-vendor':
      state.processDraft.vendor = value;
      return;
    case 'list-search':
      state.searchInput = value;
      scheduleSearch();
      return;
    default:
      break;
  }

  const ds = target.dataset;

  if (ds.lineId && ds.lineField) {
    const line = state.createForm.items.find((it) => it.id === ds.lineId);
    if (!line) return;
    if (ds.lineField === 'name') {
      line.name = value;
      const match = findCatalogItem(state.catalog, value);
      applyCatalogUnit(line, value);
      syncUnitInput(line, 'line');
      // Pre-fill the price from the catalog, but never overwrite a typed one.
      if (match && (!line.price || Number(line.price) === 0)) {
        line.price = String(match.defaultPrice);
        const priceInput = document.querySelector<HTMLInputElement>(
          `[data-line-field="price"][data-line-id="${CSS.escape(line.id)}"]`,
        );
        if (priceInput) priceInput.value = line.price;
      }
    } else if (ds.lineField === 'qty') line.qty = value;
    else if (ds.lineField === 'price') line.price = value;
    else if (ds.lineField === 'unit') {
      line.unit = value;
      line.unitFromCatalog = false;
    }
    updateCreateTotals();
    return;
  }

  if (ds.reqId && ds.reqField) {
    const line = state.reqForm.items.find((it) => it.id === ds.reqId);
    if (!line) return;
    if (ds.reqField === 'name') {
      line.name = value;
      applyCatalogUnit(line, value);
      syncUnitInput(line, 'req');
    } else if (ds.reqField === 'qty') line.qty = value;
    else if (ds.reqField === 'unit') {
      line.unit = value;
      line.unitFromCatalog = false;
    }
    return;
  }

  if (ds.receiveId) {
    state.receiveDraft[ds.receiveId] = value;
    return;
  }

  if (ds.procPriceId) {
    state.processDraft.prices[ds.procPriceId] = value;
    updateProcessTotals();
  }
}

async function onChange(event: Event): Promise<void> {
  const target = event.target;
  const profile = state.profile;
  if (!profile) return;

  if (target instanceof HTMLSelectElement && target.id === 'search-field') {
    state.searchField = target.value as typeof state.searchField;
    resetPaging();
    syncOrderList();
    render();
    return;
  }

  if (
    target instanceof HTMLInputElement &&
    (target.id === 'filter-from' || target.id === 'filter-to')
  ) {
    if (target.id === 'filter-from') state.createdFrom = target.value;
    else state.createdTo = target.value;
    resetPaging();
    syncOrderList();
    render();
    return;
  }

  if (target instanceof HTMLInputElement && target.id === 'show-deleted') {
    state.filter = { ...state.filter, deleted: target.checked };
    resetPaging();
    syncOrderList();
    render();
    return;
  }

  if (target instanceof HTMLSelectElement && target.dataset.userRole) {
    const uid = target.dataset.userRole;
    const value = target.value;
    const user = state.users.find((u) => u.uid === uid);
    if (!user || !APP_ROLES.includes(value as AppRole)) return;
    await run(() => setUserRole(profile, user, value as AppRole), 'Could not change the role.');
    return;
  }

  if (target instanceof HTMLInputElement && target.dataset.userName) {
    const uid = target.dataset.userName;
    const user = state.users.find((u) => u.uid === uid);
    const name = target.value.trim();
    if (!user || !name || name === user.name) return;
    await run(() => setUserName(profile, user, name), 'Could not rename the account.');
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === 'login-username' || target.id === 'login-password') {
    document.getElementById('signin-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}

/**
 * Attach once, at startup. Delegated listeners survive every re-render, so
 * nothing has to be re-bound the way the prototype re-bound it on each paint.
 */
export function attachHandlers(): void {
  document.addEventListener('click', (e) => void onClick(e));
  document.addEventListener('input', onInput);
  document.addEventListener('change', (e) => void onChange(e));
  document.addEventListener('keydown', onKeydown);
}
