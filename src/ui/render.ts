import { canSeeView, defaultViewFor } from '../domain/permissions';
import type { AppRole, OrderStatus, View } from '../types';
import { state } from '../state';
import { gateScreen, loadingScreen, loginScreen, sidebar } from './chrome';
import {
  completeView,
  dashboardView,
  pendingView,
  requirementsQueueView,
} from './orderViews';
import { createView, requirementFormView } from './forms';
import { activityView, catalogView, usersView } from './adminViews';
import { processDrawer, receiveDrawer } from './drawers';

/** Statuses each list view queries. Drafts only appear for those who can place them. */
export function statusesForView(view: View, role: AppRole | undefined): readonly OrderStatus[] | undefined {
  switch (view) {
    case 'requirements':
      return ['requirement'];
    case 'pending':
      return role === 'admin'
        ? ['draft', 'pending', 'partial', 'received']
        : ['pending', 'partial', 'received'];
    case 'complete':
      return ['complete', 'received'];
    default:
      return undefined; // dashboard: everything
  }
}

function mainContent(): string {
  const role = state.profile?.role as AppRole | undefined;
  switch (state.view) {
    case 'dashboard':
      return dashboardView();
    case 'create':
      return role === 'operator' ? requirementFormView() : createView();
    case 'requirements':
      return requirementsQueueView();
    case 'pending':
      return pendingView();
    case 'complete':
      return completeView();
    case 'catalog':
      return catalogView();
    case 'users':
      return usersView();
    case 'activity':
      return activityView();
    default:
      return '';
  }
}

/**
 * Re-rendering replaces the DOM wholesale, which would drop focus and the caret
 * mid-typing. Capture and restore them around the swap so search and inline
 * edits stay usable.
 */
function captureFocus(): (() => void) | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;

  const selector = el.id
    ? `#${CSS.escape(el.id)}`
    : el.dataset.lineId
      ? `[data-line-id="${CSS.escape(el.dataset.lineId)}"][data-line-field="${CSS.escape(el.dataset.lineField ?? '')}"]`
      : el.dataset.reqId
        ? `[data-req-id="${CSS.escape(el.dataset.reqId)}"][data-req-field="${CSS.escape(el.dataset.reqField ?? '')}"]`
        : el.dataset.receiveId
          ? `[data-receive-id="${CSS.escape(el.dataset.receiveId)}"]`
          : el.dataset.procPriceId
            ? `[data-proc-price-id="${CSS.escape(el.dataset.procPriceId)}"]`
            : null;
  if (!selector) return null;

  const start = el.selectionStart;
  const end = el.selectionEnd;

  return () => {
    const next = document.querySelector(selector);
    if (!(next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) return;
    next.focus();
    // Only text-like inputs support selection ranges; number inputs throw.
    if (start !== null && end !== null && next.type !== 'number' && next.type !== 'date') {
      try {
        next.setSelectionRange(start, end);
      } catch {
        /* input type does not support selection; focus alone is enough */
      }
    }
  };
}

export function render(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const restoreFocus = captureFocus();

  if (state.phase === 'loading') {
    app.className = '';
    app.innerHTML = loadingScreen('Loading shared data…');
    return;
  }

  if (state.phase === 'signed-out') {
    app.className = '';
    app.innerHTML = loginScreen();
    restoreFocus?.();
    return;
  }

  if (state.phase === 'pending-approval') {
    app.className = '';
    app.innerHTML = gateScreen();
    return;
  }

  const role = state.profile?.role as AppRole | undefined;
  if (!canSeeView(role, state.view)) state.view = defaultViewFor(role);

  app.className = 'with-sidebar';
  app.innerHTML = `${sidebar()}<main>${mainContent()}</main>${
    state.receivingOrderId ? receiveDrawer() : ''
  }${state.processingOrderId ? processDrawer() : ''}`;

  restoreFocus?.();
}
