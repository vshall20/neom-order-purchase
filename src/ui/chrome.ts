import { escapeHtml, initialsOf } from '../domain/format';
import { can, canSeeView } from '../domain/permissions';
import { ROLES, type AppRole, type View } from '../types';
import { state } from '../state';
import { icon } from './icons';

const LOGO = '/logo.png';

export function loginScreen(): string {
  return `
  <div class="login-screen">
    <div class="login-card">
      <div class="login-brand">
        <img src="${LOGO}" alt="Neom Modular Pvt Ltd"/>
        <h1>Neom Modular</h1>
        <div class="sub">Purchase Order Management &middot; Sign in with your login ID</div>
      </div>
      ${state.loginError ? `<div class="login-error">${escapeHtml(state.loginError)}</div>` : ''}
      <div class="field"><label>Login ID</label>
        <input type="text" id="login-username" placeholder="e.g. pmanager1" value="${escapeHtml(state.loginId)}" autocomplete="username"/></div>
      <div class="field"><label>Password</label>
        <input type="password" id="login-password" placeholder="••••••••" autocomplete="current-password"/></div>
      <button class="btn btn-primary" id="signin-btn" ${state.loginBusy ? 'disabled' : ''}>
        ${state.loginBusy ? 'Signing in…' : 'Sign in'}</button>
      <div class="login-hint">Login IDs are created and managed by your Admin.<br/>
        Forgot your password? Ask your admin to reset it.</div>
    </div>
  </div>`;
}

/**
 * Shown to a signed-in user whose profile is still `pending` or inactive.
 * They have a credential but no role, so they can see and do nothing.
 */
export function gateScreen(): string {
  const p = state.profile;
  const deactivated = !!p && p.role !== 'pending' && !p.active;
  return `
  <div class="login-screen">
    <div class="login-card" style="text-align:center;">
      <img src="${LOGO}" alt="Neom Modular Pvt Ltd" style="height:44px; margin-bottom:14px;"/>
      <h1 style="font-size:17px; margin:0 0 8px 0;">${deactivated ? 'Account disabled' : 'Awaiting approval'}</h1>
      <div class="muted" style="line-height:1.6;">
        ${
          deactivated
            ? 'This login has been deactivated. Contact your admin to have it re-enabled.'
            : `Signed in as <b>${escapeHtml(p?.loginId ?? '')}</b>.<br/>An administrator needs to assign you a role before you can use the system.`
        }
      </div>
      <button class="btn btn-outline" id="signout-btn" style="margin-top:20px; width:100%;">Sign out</button>
    </div>
  </div>`;
}

export function loadingScreen(message = 'Loading…'): string {
  return `
  <div class="login-screen">
    <div class="login-card" style="text-align:center;">
      <img src="${LOGO}" alt="Neom Modular Pvt Ltd" style="height:44px; margin-bottom:14px;"/>
      <div class="muted">${escapeHtml(message)}</div>
    </div>
  </div>`;
}

interface NavItem {
  v: View;
  label: string;
  ic: string;
  count?: number | undefined;
}

export function sidebar(): string {
  const p = state.profile;
  if (!p) return '';
  const role = p.role as AppRole;
  const c = state.counts;

  const mainCandidates: NavItem[] = [
    { v: 'dashboard', label: 'Dashboard', ic: 'dashboard' },
    { v: 'create', label: role === 'operator' ? 'Place requirement' : 'Create order', ic: 'create' },
    { v: 'requirements', label: 'Requirements queue', ic: 'req', count: c.requirement },
    {
      v: 'pending',
      label: 'Pending & receiving',
      ic: 'pending',
      count: (c.pending ?? 0) + (c.partial ?? 0) || undefined,
    },
    { v: 'complete', label: 'Completed orders', ic: 'complete', count: c.received },
  ];
  const mainItems = mainCandidates.filter((it) => canSeeView(role, it.v));

  const adminCandidates: NavItem[] = [
    { v: 'catalog', label: 'Item catalog', ic: 'catalog', count: state.catalog.length || undefined },
    { v: 'users', label: 'User accounts', ic: 'users', count: state.users.length || undefined },
    { v: 'activity', label: 'Activity log', ic: 'activity' },
  ];
  const adminItems = adminCandidates.filter((it) => canSeeView(role, it.v));

  const navButton = (it: NavItem): string => `
    <button class="nav-btn ${state.view === it.v ? 'active' : ''}" data-nav="${it.v}">
      ${icon(it.ic)}<span>${it.label}</span>${it.count ? `<span class="nav-count">${it.count}</span>` : ''}
    </button>`;

  return `
  <div class="sidebar">
    <div class="brand">
      <div class="brand-logo">
        <img src="${LOGO}" alt="Neom Modular Pvt Ltd"/>
        <div>
          <h1 style="font-size:15.5px; line-height:1.25;">Neom Modular</h1>
          <div class="sub" style="margin-top:1px;">Pvt Ltd</div>
        </div>
      </div>
      <div class="sub" style="margin-top:8px;">Purchase order management</div>
    </div>
    <nav>
      ${mainItems.map(navButton).join('')}
      ${adminItems.length ? '<div class="nav-divider"></div>' : ''}
      ${adminItems.map(navButton).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="user-chip">
        <div class="user-avatar">${initialsOf(p.name)}</div>
        <div class="user-meta">
          <div class="uname">${escapeHtml(p.name)}</div>
          <div class="urole">${ROLES[role].short} · ${escapeHtml(p.loginId)}</div>
        </div>
      </div>
      <button class="signout-btn" id="signout-btn">Sign out</button>
    </div>
  </div>`;
}

export function pageHeader(
  eyebrow: string,
  title: string,
  desc: string,
  actionHtml?: string,
): string {
  const role = state.profile?.role as AppRole | undefined;
  return `
  <div class="page-header">
    <div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${desc}</p></div>
    <div style="display:flex; align-items:center; gap:12px;">
      ${role ? `<span class="role-pill ${role}">${ROLES[role].short}</span>` : ''}
      ${actionHtml ?? ''}
    </div>
  </div>`;
}

export function emptyState(big: string, small: string): string {
  return `<div class="empty"><div class="big">${escapeHtml(big)}</div><div class="small">${escapeHtml(small)}</div></div>`;
}

export function newOrderButton(): string {
  const role = state.profile?.role;
  if (!can(role, 'createFullOrder') && !can(role, 'submitRequirement')) return '';
  return `<button class="btn btn-primary" data-nav="create">${icon('create')} New order</button>`;
}
