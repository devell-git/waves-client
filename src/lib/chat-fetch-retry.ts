/**
 * Retry de fetch/stream para `/api/chat` — mitiga "Load failed" no Safari mobile
 * quando a conexão cai no handshake ou antes do primeiro byte do SSE.
 */

const NETWORK_ERROR_RE =
  /load failed|failed to fetch|networkerror|network error|the internet connection appears to be offline|aborted/i;

export function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  const msg = err instanceof Error ? err.message : String(err);
  return NETWORK_ERROR_RE.test(msg);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Faz POST em `/api/chat` com até `maxAttempts` tentativas em erro de rede
 * antes de receber a Response.
 */
export async function fetchChatWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
): Promise<Response> {
  let lastErr: unknown = null;
  const signal = init.signal ?? undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastErr = err;
      if (!isRetryableNetworkError(err) || attempt >= maxAttempts - 1) break;
      await delay(400 * (attempt + 1), signal ?? new AbortController().signal);
    }
  }
  throw lastErr ?? new Error("fetch falhou após retries");
}

/**
 * Re-tenta o fetch do SSE se a leitura do body falhar ANTES de enviar bytes
 * ao cliente (evita duplicar chunks parciais no chat).
 */
export function wrapSseResponseForRetry(
  makeResponse: () => Promise<Response>,
  signal: AbortSignal,
  maxAttempts = 2,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let bytesForwarded = 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await makeResponse();
          if (!res.ok) {
            controller.error(
              new Error(`Request failed: ${res.status} ${res.statusText}`),
            );
            return;
          }
          if (!res.body) {
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) bytesForwarded += value.byteLength;
            controller.enqueue(value);
          }
          controller.close();
          return;
        } catch (err) {
          if (signal.aborted) {
            controller.error(err);
            return;
          }
          const canRetry =
            bytesForwarded === 0 &&
            isRetryableNetworkError(err) &&
            attempt < maxAttempts - 1;
          if (!canRetry) {
            controller.error(err);
            return;
          }
          await delay(500 * (attempt + 1), signal);
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
