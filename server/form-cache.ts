/**
 * Cache em memória pra respostas do Hermes a triggers de formulário.
 *
 * Pra triggers determinísticos (`__form_cnpj__`, `__form_cpf__`), a resposta do
 * Hermes é sempre o mesmo bloco openui-lang. Em vez de fazer a viagem completa
 * `Express → Hermes → Anthropic → stream de volta` (3-4s), guardamos a resposta
 * em memória após a primeira chamada e servimos as próximas em <50ms.
 *
 * Invalidação:
 * - Por TTL de 1h. O waves_client é desacoplado do filesystem do Hermes
 *   (apps independentes, possivelmente em servers diferentes), então NÃO
 *   inspecionamos o SOUL.md do profile — confiamos só no TTL + restart.
 *
 * O cache vive no processo do Express. Restart do server limpa o cache.
 */

interface CacheEntry {
  /** O openui-lang puro (content da response do Hermes). */
  content: string;
  /** Quando a entrada foi criada (epoch ms). */
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000;

/** Triggers que ficam em cache. Qualquer outro user message ignora cache. */
const CACHEABLE_TRIGGERS = new Set([
  "__form_cnpj__",
  "__form_cpf__",
]);

export function isCacheableTrigger(message: string | null | undefined): boolean {
  if (!message) return false;
  return CACHEABLE_TRIGGERS.has(message.trim().toLowerCase());
}

/**
 * Devolve a resposta cacheada se ainda for válida (dentro do TTL).
 * Retorna null em miss.
 */
export function getCached(trigger: string): string | null {
  const key = trigger.trim().toLowerCase();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.content;
}

/**
 * Grava a resposta no cache. Apenas conteúdo que parece openui-lang válido
 * (começa com `root`) é gravado, pra evitar cachear erros transitórios.
 */
export function setCached(trigger: string, content: string): void {
  const key = trigger.trim().toLowerCase();
  const trimmed = content.trim();
  if (!trimmed.startsWith("root")) return;
  cache.set(key, {
    content: trimmed,
    createdAt: Date.now(),
  });
}

/** Útil pra debug/teste. */
export function clearCache(): void {
  cache.clear();
}

export function cacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
