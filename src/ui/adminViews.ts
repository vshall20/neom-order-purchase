import { escapeHtml, fmtDateTime, fmtMoney } from '../domain/format';
import { APP_ROLES, ROLES, type AppRole } from '../types';
import { state } from '../state';
import { emptyState, pageHeader } from './chrome';
import { icon } from './icons';

export function catalogView(): string {
  const f = state.newItemForm;
  return `
    ${pageHeader('Master data', 'Item catalog', 'Save item descriptions once so they are quick to pick from every time you place an order.')}
    <div class="form-panel" style="margin-bottom:24px;">
      ${f.error ? `<div class="notice err">${escapeHtml(f.error)}</div>` : ''}
      <div class="form-row">
        <div class="field"><label>Item description</label>
          <input type="text" id="ci-name" placeholder="e.g. Structural angle bar 2in" value="${escapeHtml(f.name)}"/></div>
        <div class="field" style="max-width:150px;"><label>Unit</label>
          <input type="text" id="ci-unit" placeholder="pcs / kg / box" value="${escapeHtml(f.unit)}"/></div>
        <div class="field" style="max-width:180px;"><label>Default price (₹)</label>
          <input type="number" min="0" step="0.01" id="ci-price" placeholder="0.00" value="${escapeHtml(f.defaultPrice)}"/></div>
      </div>
      <div class="form-footer" style="border-top:none; margin-top:6px; padding-top:0; justify-content:flex-end;">
        <div class="form-actions">
          <button class="btn btn-primary" id="add-item-btn" ${state.busy ? 'disabled' : ''}>${icon('catalog')} Add to catalog</button>
        </div>
      </div>
    </div>
    <div class="panel">
      ${
        state.catalog.length === 0
          ? emptyState('Catalog is empty', 'Add item descriptions here so Operators and the Purchase Manager can pick them instantly next time.')
          : `<table class="user-table">
              <thead><tr><th>Item description</th><th>Unit</th><th>Default price</th><th>Status</th><th></th></tr></thead>
              <tbody>${state.catalog
                .map(
                  (ci) => `
                <tr>
                  <td class="vendor">${escapeHtml(ci.name)}</td>
                  <td class="muted">${ci.unit ? escapeHtml(ci.unit) : '—'}</td>
                  <td class="mono">${fmtMoney(ci.defaultPrice)}</td>
                  <td><span class="stamp ${ci.active ? 'active-y' : 'active-n'}">${ci.active ? 'Active' : 'Disabled'}</span></td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-outline" data-toggle-item="${ci.id}">${ci.active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>`,
                )
                .join('')}</tbody>
            </table>`
      }
    </div>
    <div class="notice subtle">Catalog items are disabled rather than deleted, so past orders that used them still read correctly.</div>`;
}

export function usersView(): string {
  const me = state.profile;
  return `
    ${pageHeader('Administration', 'User accounts', 'Assign roles to people who have signed in. Login credentials are created in the Firebase console.')}
    <div class="notice">
      <b>Adding someone:</b> create their account in the Firebase console
      (Authentication → Add user), have them sign in once, then set their role here.
      Password resets are also done from the console.
    </div>
    <div class="panel">
      ${
        state.users.length === 0
          ? emptyState('No accounts yet', 'People appear here after they sign in for the first time.')
          : `<table class="user-table">
              <thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th>Status</th><th></th></tr></thead>
              <tbody>${state.users
                .map((u) => {
                  const isSelf = me?.uid === u.uid;
                  const pending = u.role === 'pending';
                  return `
                <tr class="${pending ? 'row-pending' : ''}">
                  <td class="vendor">
                    <input type="text" class="inline-input" value="${escapeHtml(u.name)}" data-user-name="${u.uid}" ${isSelf ? 'disabled' : ''}/>
                  </td>
                  <td><span class="cred-tag">${escapeHtml(u.loginId)}</span></td>
                  <td>
                    ${
                      isSelf
                        ? `<span class="role-pill ${u.role}">${ROLES[u.role as AppRole]?.short ?? 'Pending'}</span>`
                        : `<select class="inline-select" data-user-role="${u.uid}">
                             ${pending ? '<option value="pending" selected>— Unassigned —</option>' : ''}
                             ${APP_ROLES.map(
                               (r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLES[r].label}</option>`,
                             ).join('')}
                           </select>`
                    }
                  </td>
                  <td><span class="stamp ${u.active ? 'active-y' : 'active-n'}">${u.active ? 'Active' : 'Disabled'}</span></td>
                  <td class="row-actions">
                    ${
                      isSelf
                        ? '<span class="muted" style="align-self:center;">You</span>'
                        : `<button class="btn btn-sm btn-outline" data-toggle-user="${u.uid}">${u.active ? 'Disable' : 'Enable'}</button>`
                    }
                  </td>
                </tr>`;
                })
                .join('')}</tbody>
            </table>`
      }
    </div>
    <div class="notice subtle">
      You cannot change your own role or disable yourself — that guard is enforced by the
      security rules, so the organisation can never be locked out of its own admin account.
    </div>`;
}

export function activityView(): string {
  const scoped = state.auditTargetId;
  return `
    ${pageHeader(
      'Oversight',
      scoped ? 'Order history' : 'Activity log',
      scoped
        ? 'Every recorded change to this order, newest first.'
        : 'Every recorded change across orders, accounts, and the catalog. Append-only.',
      scoped ? '<button class="btn btn-outline" id="clear-audit-scope">Show all activity</button>' : '',
    )}
    <div class="panel">
      ${
        state.audit.length === 0
          ? emptyState('Nothing recorded yet', 'Actions are logged here as people use the system.')
          : `<table class="user-table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>${state.audit
                .map(
                  (e) => `
                <tr>
                  <td class="muted mono" style="white-space:nowrap;">${fmtDateTime(e.at)}</td>
                  <td>${escapeHtml(e.actor.name)}<div class="muted" style="font-size:11px;">${escapeHtml(e.actor.role)}</div></td>
                  <td><span class="cred-tag">${escapeHtml(e.action)}</span></td>
                  <td>${escapeHtml(e.summary)}</td>
                </tr>`,
                )
                .join('')}</tbody>
            </table>`
      }
    </div>`;
}
