/**
 * Ping leve no Express do waves_client — navigator.onLine não basta.
 */

/** Intervalo entre pings enquanto há erro de rede (ms). */
export const SERVER_PING_INTERVAL_MS = 2_000;

/** Timeout de cada ping — curto pra não “travar” o aviso na tela. */
export const SERVER_PING_TIMEOUT_MS = 2_500;

export async function probeChatApi(
  timeoutMs = SERVER_PING_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const r = await fetch(`/api/health?_=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok;
  } catch {
    return false;
  }
}
