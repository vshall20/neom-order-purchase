import './styles.css';
import { startSession } from './auth/session';
import { defaultViewFor } from './domain/permissions';
import { state, unsubscribeAll } from './state';
import { attachHandlers } from './ui/handlers';
import { render } from './ui/render';
import { startSessionSubscriptions, syncViewSubscriptions } from './ui/subscriptions';
import { toast } from './ui/toast';

attachHandlers();
render();

/** True once the signed-in user has a real role and an active account. */
function isUsable(role: string, active: boolean): boolean {
  return active && role !== 'pending';
}

let previousUid: string | null = null;

startSession({
  onSignedOut() {
    unsubscribeAll();
    previousUid = null;
    Object.assign(state, {
      phase: 'signed-out',
      profile: null,
      orders: [],
      users: [],
      audit: [],
      catalog: [],
      counts: {},
      receivingOrderId: null,
      processingOrderId: null,
      loginPassword: '',
    });
    render();
  },

  onProfile(profile) {
    const wasUsable = state.profile ? isUsable(state.profile.role, state.profile.active) : false;
    const nowUsable = isUsable(profile.role, profile.active);
    const isNewSession = previousUid !== profile.uid;

    state.profile = profile;

    if (!nowUsable) {
      // Role revoked or account disabled while the tab was open.
      if (wasUsable) {
        unsubscribeAll();
        toast('Your access was changed by an administrator.', { tone: 'error' });
      }
      state.phase = 'pending-approval';
      previousUid = profile.uid;
      render();
      return;
    }

    state.phase = 'ready';

    if (isNewSession || !wasUsable) {
      // Fresh sign-in, or a role was just granted: pick a landing view and
      // start the listeners this role is allowed to have.
      state.view = defaultViewFor(profile.role);
      previousUid = profile.uid;
      startSessionSubscriptions();
      syncViewSubscriptions();
    }

    render();
  },

  onError(message) {
    state.phase = 'signed-out';
    state.loginError = message;
    render();
  },
});
