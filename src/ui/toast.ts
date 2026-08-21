import { escapeHtml } from '../domain/format';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

let seq = 0;

/**
 * Transient message in the bottom-left. Used for the undo affordance after a
 * soft delete, and for surfacing permission-denied errors from the rules.
 */
export function toast(
  message: string,
  opts: { action?: ToastAction; timeoutMs?: number; tone?: 'info' | 'error' } = {},
): void {
  const host = document.getElementById('toast-host');
  if (!host) return;

  const id = `toast-${++seq}`;
  const tone = opts.tone ?? 'info';
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.id = id;
  el.innerHTML = `
    <span class="toast-msg">${escapeHtml(message)}</span>
    ${opts.action ? `<button class="toast-action" type="button">${escapeHtml(opts.action.label)}</button>` : ''}
    <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>`;

  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 180);
  };

  el.querySelector('.toast-close')?.addEventListener('click', dismiss);

  const action = opts.action;
  if (action) {
    el.querySelector('.toast-action')?.addEventListener('click', () => {
      dismiss();
      void action.run();
    });
  }

  host.appendChild(el);
  const timer = setTimeout(dismiss, opts.timeoutMs ?? (opts.action ? 10_000 : 4500));
}

/** Turns a thrown Firestore error into a message that says what to do next. */
export function errorToast(e: unknown, fallback: string): void {
  const message =
    e instanceof Error && e.message.includes('permission')
      ? 'Your role does not allow that. The change was rejected by the server.'
      : e instanceof Error && e.message
        ? e.message
        : fallback;
  toast(message, { tone: 'error' });
}
