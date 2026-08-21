import { FirebaseError } from 'firebase/app';
import { watchCatalog } from '../data/catalog';
import { watchUsers } from '../data/users';
import { countByStatus, watchAuditPage, watchOrderPage, type OrderFilter } from '../data/queries';
import { ORDER_STATUSES, type AppRole } from '../types';
import { state, subscribe, unsubscribe } from '../state';
import { render, statusesForView } from './render';

function listErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError && e.code === 'failed-precondition') {
    return 'This view needs a Firestore index that has not been created yet. Run: npx firebase deploy --only firestore:indexes';
  }
  if (e instanceof FirebaseError && e.code === 'permission-denied') {
    return 'You do not have permission to read this list.';
  }
  return 'Could not load the list. Check your connection and try again.';
}

/** Build the Firestore filter for the current view, search box, and toggles. */
export function currentFilter(): OrderFilter {
  const role = state.profile?.role as AppRole | undefined;
  const statuses = state.filter.statuses?.length
    ? state.filter.statuses
    : statusesForView(state.view, role);
  const term = state.searchInput.trim();

  return {
    deleted: state.filter.deleted ?? false,
    ...(statuses ? { statuses } : {}),
    ...(term ? { search: { field: state.searchField, value: term } } : {}),
  };
}

let countTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Counts are derived from a separate aggregation query, so they do not update
 * when the order snapshot changes. Refresh them alongside it — debounced,
 * because a burst of writes would otherwise fire one aggregation per write —
 * so the dashboard tiles and sidebar badges track other people's changes too.
 */
function scheduleCountRefresh(): void {
  clearTimeout(countTimer);
  countTimer = setTimeout(() => void refreshCounts(), 400);
}

/** (Re)subscribe the order list for the current view, filter, and page. */
export function syncOrderList(): void {
  const after = state.pageStack[state.pageStack.length - 1] ?? null;
  const filter = currentFilter();

  subscribe('orders', () =>
    watchOrderPage(
      filter,
      after,
      (page) => {
        state.orders = page.orders;
        state.nextCursor = page.next;
        state.listError = '';
        render();
        scheduleCountRefresh();
      },
      (e) => {
        state.listError = listErrorMessage(e);
        state.orders = [];
        render();
      },
    ),
  );
}

export function syncAuditList(): void {
  subscribe('audit', () =>
    watchAuditPage(
      state.auditTargetId ? { targetId: state.auditTargetId } : {},
      null,
      (entries) => {
        state.audit = entries;
        render();
      },
      (e) => {
        state.listError = listErrorMessage(e);
        state.audit = [];
        render();
      },
    ),
  );
}

/**
 * Counts for the dashboard tiles and sidebar badges, via server-side
 * aggregation so the client never downloads orders just to count them.
 */
export async function refreshCounts(): Promise<void> {
  try {
    state.counts = await countByStatus(ORDER_STATUSES);
    render();
  } catch {
    /* Counts are decorative; a failure here must not block the app. */
  }
}

/** Subscriptions that stay up for the whole session once a role is assigned. */
export function startSessionSubscriptions(): void {
  subscribe('catalog', () =>
    watchCatalog((items) => {
      state.catalog = items;
      render();
    }),
  );
  void refreshCounts();
}

/** View-scoped subscriptions. Called whenever the active view changes. */
export function syncViewSubscriptions(): void {
  const view = state.view;

  if (view === 'users') {
    subscribe('users', () =>
      watchUsers(
        (users) => {
          state.users = users;
          render();
        },
        (e) => {
          state.listError = listErrorMessage(e);
          render();
        },
      ),
    );
  } else {
    unsubscribe('users');
  }

  if (view === 'activity') {
    syncAuditList();
  } else {
    unsubscribe('audit');
  }

  if (view === 'dashboard' || view === 'requirements' || view === 'pending' || view === 'complete') {
    syncOrderList();
  } else {
    unsubscribe('orders');
    state.orders = [];
  }
}
