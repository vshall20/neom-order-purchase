/**
 * Accounts are created by an admin in the Firebase Auth console, which keys
 * every account to an email address. Not every worker at Neom Modular has one,
 * so accounts for those users are created with a synthetic address
 * (`ananya.r@neommodular.local`) and they sign in with just the login ID.
 *
 * Rule: anything containing "@" is treated as a real email and used as-is;
 * anything else gets the configured domain appended.
 */
export function toSignInEmail(input: string, domain: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.includes('@') ? trimmed : `${trimmed}@${domain}`;
}

/** Inverse, for display: strips a synthetic domain but keeps real addresses whole. */
export function toDisplayLoginId(email: string, domain: string): string {
  const lower = (email || '').toLowerCase();
  const suffix = `@${domain.toLowerCase()}`;
  return lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
}
