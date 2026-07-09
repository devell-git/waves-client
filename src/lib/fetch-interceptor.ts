// Interceptor de sessão morta — reativado de forma CONSERVADORA.
//
// Histórico: uma versão anterior fazia logout em QUALQUER 401/403 de /api/*.
// Isso deslogava usuários com permissão limitada que recebiam 403 LEGÍTIMO do
// agente (ex.: role Workflows sem create-document). Por isso foi desabilitado.
//
// Esta versão dispara `onUnauthorized` (logout) SOMENTE quando:
//   - status === 401 (token de fato rejeitado — NÃO 403, que é permissão), E
//   - a request é pro proxy de AUTH do tenant `/api/waves/*` (login/user/etc.),
//     NUNCA pra `/api/chat`, `/api/threads`, specialist-jobs ou endpoints de
//     agente (onde 401/403 pode ser específico do gateway/permissão).
//
// Assim, token morto de verdade (Waves recusa) desloga; 403 de permissão e
// intermitência de gateway não deslogam.

/** Casa apenas o proxy de auth do tenant (mesma origem ou absoluto). */
function isAuthProxyUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/waves/");
  } catch {
    return false;
  }
}

export function installAuthInterceptor(onUnauthorized: () => void): () => void {
  const original = window.fetch.bind(window);
  let fired = false;

  const patched: typeof window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status === 401 && !fired) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      if (isAuthProxyUrl(url)) {
        fired = true; // evita múltiplos logouts numa rajada de requests
        onUnauthorized();
      }
    }
    return response;
  };

  window.fetch = patched;
  return () => {
    // Só restaura se ninguém sobrescreveu no meio-tempo.
    if (window.fetch === patched) window.fetch = original;
  };
}
