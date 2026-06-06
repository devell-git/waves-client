// Cache de respostas READ da API Waves no proxy — combate o 429 (rate limit).
// A Waves não tem statistics agregado, então o runtime itera ~25 APs (burst de
// statistics/overview). Sem cache, cada render/re-render/componente refaz o burst
// → 429. Aqui guardamos as respostas GET de statistics + lista de workflows por
// ~60s, com chave POR USUÁRIO (Authorization) e POR TENANT — re-renders e vários
// componentes compartilham o dado em vez de re-bater na Waves.
//
// Só cacheia 200 (nunca 429/erro). Dado de statistics não é tempo-real-crítico;
// 60s é seguro.
import { createHash } from "node:crypto";

const TTL_MS = 60_000;
const MAX_ENTRIES = 3000;

interface Entry {
  at: number;
  contentType: string | null;
  body: Buffer;
}

const cache = new Map<string, Entry>();

/** GETs de statistics/* e da lista de workflows são os caros/repetidos. */
export function isCacheableWaves(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return (
    /\/statistics(\/|\?|$)/.test(path) ||
    /^\/openui\/tools\/workflows(\?|$|\/)/.test(path)
  );
}

/** Chave isola por tenant + usuário (hash do Authorization) + caminho exato. */
export function wavesCacheKey(tenantId: string, auth: string | undefined, path: string): string {
  const a = auth ? createHash("sha1").update(auth).digest("base64").slice(0, 16) : "anon";
  return `${tenantId}|${a}|${path}`;
}

export function getWavesCache(key: string): Entry | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e;
}

export function setWavesCache(
  key: string,
  status: number,
  contentType: string | null,
  body: Buffer,
): void {
  if (status !== 200) return; // nunca cacheia 429/erro
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value; // FIFO simples
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), contentType, body });
}
