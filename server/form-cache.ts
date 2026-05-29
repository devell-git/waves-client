/**
 * Cache em memória pra respostas do Hermes a triggers de formulário.
 *
 * Pra triggers determinísticos (`__form_cnpj__`, `__form_cpf__`), a resposta do
 * Hermes é sempre o mesmo bloco openui-lang. Em vez de fazer a viagem completa
 * `Express → Hermes → Anthropic → stream de volta` (3-4s), guardamos a resposta
 * em memória após a primeira chamada e servimos as próximas em <50ms.
 *
 * Invalidação:
 * - Por hash do `SOUL.md` do profile. Quando o arquivo muda (rebuild do prompt),
 *   o cache vira inválido automaticamente.
 * - Por TTL de 1h (defensivo, caso algum estado mude sem refletir no SOUL).
 *
 * O cache vive no processo do Express. Restart do server limpa o cache.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

interface CacheEntry {
  /** O openui-lang puro (content da response do Hermes). */
  content: string;
  /** Mtime do SOUL.md quando a entrada foi gravada. */
  soulMtime: number;
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

/**
 * Path do SOUL.md do profile ativo. Resolvido via env quando possível, com
 * fallback pro path padrão do ybrax-negative-media.
 */
function getSoulPath(): string {
  const profile = process.env.HERMES_PROFILE ?? "ybrax-negative-media";
  return resolve(homedir(), ".hermes", "profiles", profile, "SOUL.md");
}

function getSoulMtime(): number {
  try {
    const p = getSoulPath();
    if (!existsSync(p)) return 0;
    return Math.floor(statSync(p).mtimeMs);
  } catch {
    return 0;
  }
}

export function isCacheableTrigger(message: string | null | undefined): boolean {
  if (!message) return false;
  return CACHEABLE_TRIGGERS.has(message.trim().toLowerCase());
}

/**
 * Devolve a resposta cacheada se ainda for válida (mesmo mtime do SOUL + TTL).
 * Retorna null em miss.
 */
export function getCached(trigger: string): string | null {
  const key = trigger.trim().toLowerCase();
  const entry = cache.get(key);
  if (!entry) return null;
  // mtime atual do SOUL → se mudou, invalida tudo
  const currentMtime = getSoulMtime();
  if (currentMtime === 0 || currentMtime !== entry.soulMtime) {
    cache.delete(key);
    return null;
  }
  // TTL defensivo
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.content;
}

/**
 * Grava a resposta no cache. Apenas conteúdo que parece openui-lang válido
 * (começa com `root =`) é gravado, pra evitar cachear erros transitórios.
 */
export function setCached(trigger: string, content: string): void {
  const key = trigger.trim().toLowerCase();
  const trimmed = content.trim();
  if (!trimmed.startsWith("root")) return;
  cache.set(key, {
    content: trimmed,
    soulMtime: getSoulMtime(),
    createdAt: Date.now(),
  });
}

/** Útil pra debug/teste. */
export function clearCache(): void {
  cache.clear();
}

export function cacheStats(): { size: number; keys: string[]; soulMtime: number } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    soulMtime: getSoulMtime(),
  };
}

// Hash util, exposto pra futuro debug/visualização
export function soulHash(): string {
  try {
    const p = getSoulPath();
    if (!existsSync(p)) return "";
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}
