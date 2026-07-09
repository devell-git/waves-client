/**
 * Allowlist de hosts pra ação open_url do openui-lang.
 * Centralizado — futuro: carregar de config por tenant (pull).
 */

const HOST_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*devell\.com\.br(\/|$)/i,
  /^https:\/\/secure\.d4sign\.com\.br(\/|$)/i,
  /^https:\/\/teams\.microsoft\.com(\/|$)/i,
];

/** `true` se a URL pode ser aberta em nova aba pelo client. */
export function isOpenUrlAllowed(url: string): boolean {
  if (!url) return false;
  if (/^\/[^/]/.test(url)) return true; // same-origin relativo
  return HOST_PATTERNS.some((re) => re.test(url));
}
