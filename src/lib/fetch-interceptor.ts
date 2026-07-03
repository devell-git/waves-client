// Interceptor global de 401/403 (#790, Fase 1).
//
// Quando uma chamada à API PRÓPRIA (/api/*) volta 401/403, o token Waves
// expirou/foi revogado → dispara o handler (logout + redirect /login com aviso).
// Patch único e SEGURO no window.fetch: passthrough, nunca consome o body, nunca
// lança. Ignora /api/login e /api/logout (evita loop) e chamadas cross-origin.

let patched = false;
let handler: (() => void) | null = null;
let fired = false;

function authSensitive(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    if (!u.pathname.startsWith("/api/")) return false;
    if (u.pathname.startsWith("/api/login")) return false;
    if (u.pathname.startsWith("/api/logout")) return false;
    return true;
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url ?? "";
}

/**
 * Instala o interceptor e registra o handler de "não autorizado". Idempotente:
 * o patch no window.fetch é aplicado uma única vez; chamadas seguintes só
 * (re)registram o handler. Retorna um cleanup que desregistra o handler.
 */
export function installAuthInterceptor(_onUnauthorized: () => void): () => void {
  // Desabilitado — 401/403 em qualquer /api/* causava logout automático.
  // Usuários com permissões limitadas (ex: role Workflows sem create-document)
  // recebiam 403 em chamadas do agente e eram deslogados.
  // Logout agora é apenas manual (botão Sair).
  return () => {};
}
