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
export function installAuthInterceptor(onUnauthorized: () => void): () => void {
  handler = onUnauthorized;
  fired = false;
  if (patched || typeof window === "undefined") {
    return () => {
      handler = null;
    };
  }
  patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await orig(input, init);
    try {
      if (
        (res.status === 401 || res.status === 403) &&
        !fired &&
        handler &&
        authSensitive(urlOf(input))
      ) {
        fired = true;
        const h = handler;
        // Não bloqueia a resposta; agenda o logout fora do caminho do fetch.
        setTimeout(() => {
          try {
            h();
          } catch {
            /* noop */
          }
        }, 0);
      }
    } catch {
      /* nunca quebra o fetch */
    }
    return res;
  };
  return () => {
    handler = null;
  };
}
