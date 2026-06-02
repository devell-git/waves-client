/**
 * Histórico de conversas — leitura do state.db do Hermes (SQLite).
 *
 * Cada profile tem seu próprio DB em `~/.hermes/profiles/<id>/state.db`.
 * Threads são identificadas por `session_id` no formato `<userPrefix>::<threadId>`
 * (ex.: `waves-user-1::abc123`). O `threadId` é gerado pelo frontend com
 * `crypto.randomUUID()` quando o user inicia uma conversa nova.
 *
 * Sessões antigas que ainda não usavam o sufixo `::<threadId>` (ex.:
 * `waves-user-1`, `waves-anon`) também aparecem na lista como threads sem
 * id explícito — usamos o session_id inteiro como threadId.
 */

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getActiveTenant } from "./tenants.js";

const HERMES_HOME = resolve(homedir(), ".hermes");

interface DbCache {
  db: Database.Database;
  lastUsed: number;
}

const cache = new Map<string, DbCache>();

function getDb(profileId: string): Database.Database {
  const cached = cache.get(profileId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.db;
  }
  const dbPath = resolve(HERMES_HOME, "profiles", profileId, "state.db");
  const db = new Database(dbPath, { readonly: false, fileMustExist: true });
  // pragma essenciais — perf + concurrency com o Hermes escrevendo em paralelo
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  cache.set(profileId, { db, lastUsed: Date.now() });
  return db;
}

export interface ThreadSummary {
  id: string;
  title: string | null;
  messageCount: number;
  lastUpdated: number; // epoch ms
  preview: string | null; // primeiras palavras da última msg do user
}

export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  toolCalls: unknown[] | null;
  toolName: string | null;
  toolCallId: string | null;
  timestamp: number; // epoch ms
}

export interface SearchHit {
  threadId: string;
  title: string | null;
  /** Snippet com `<mark>` em volta dos termos buscados. */
  snippet: string;
  lastUpdated: number;
}

/**
 * Filtra sessões que pertencem a um "usuário do waves_client" DO TENANT ATUAL
 * (resolvido por host via ALS). Inclui `waves-<tenant>-user-*` e
 * `waves-<tenant>-anon*`; exclui api/cron/manuais e os OUTROS tenants.
 *
 * Threads pré-tenant (formato legado `waves-user-*`) não aparecem mais — não
 * são apagadas, só ficam fora do namespace do tenant.
 */
function userSessionPattern(col = "id"): string {
  const t = getActiveTenant().id.replace(/[^a-z0-9_-]/gi, "");
  return `(${col} LIKE 'waves-${t}-user-%' OR ${col} LIKE 'waves-${t}-anon%')`;
}

export function listThreads(profileId: string, limit = 100): ThreadSummary[] {
  const db = getDb(profileId);
  const rows = db
    .prepare(
      `
      SELECT
        s.id            AS id,
        s.title         AS title,
        s.message_count AS messageCount,
        s.started_at    AS startedAt,
        (SELECT MAX(timestamp) FROM messages WHERE session_id = s.id) AS lastTs,
        (
          SELECT substr(content, 1, 200)
          FROM messages
          WHERE session_id = s.id AND role = 'user'
          ORDER BY id ASC
          LIMIT 1
        )               AS firstUserMsg
      FROM sessions s
      WHERE ${userSessionPattern()} AND s.message_count > 0
      ORDER BY COALESCE((SELECT MAX(timestamp) FROM messages WHERE session_id = s.id), s.started_at) DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    id: string;
    title: string | null;
    messageCount: number | null;
    startedAt: number | null;
    lastTs: number | null;
    firstUserMsg: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title || deriveTitle(r.firstUserMsg),
    messageCount: r.messageCount ?? 0,
    lastUpdated: Math.floor((r.lastTs ?? r.startedAt ?? 0) * 1000),
    preview: derivePreview(r.firstUserMsg),
  }));
}

export function getThreadMessages(profileId: string, threadId: string): ThreadMessage[] {
  const db = getDb(profileId);
  const rows = db
    .prepare(
      `
      SELECT id, role, content, tool_calls, tool_name, tool_call_id, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY id ASC
    `,
    )
    .all(threadId) as Array<{
    id: number;
    role: string;
    content: string | null;
    tool_calls: string | null;
    tool_name: string | null;
    tool_call_id: string | null;
    timestamp: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content ?? "",
    toolCalls: r.tool_calls ? safeJSON(r.tool_calls) : null,
    toolName: r.tool_name,
    toolCallId: r.tool_call_id,
    timestamp: Math.floor((r.timestamp ?? 0) * 1000),
  }));
}

export function searchThreads(profileId: string, query: string, limit = 50): SearchHit[] {
  if (!query.trim()) return [];
  const db = getDb(profileId);
  // FTS5 query: escapa aspas no input, divide por espaço, usa OR
  const safeQuery = sanitizeFtsQuery(query);
  if (!safeQuery) return [];

  // snippet() não funciona com GROUP BY → trazemos todos os hits e fazemos
  // dedup por threadId no JS, mantendo o primeiro snippet (mais recente).
  const rows = db
    .prepare(
      `
      SELECT
        m.session_id AS threadId,
        s.title AS title,
        snippet(messages_fts, -1, '<mark>', '</mark>', '…', 14) AS snippet,
        m.timestamp AS msgTs
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE messages_fts MATCH ?
        AND ${userSessionPattern("s.id")}
      ORDER BY m.timestamp DESC
      LIMIT ?
    `,
    )
    .all(safeQuery, limit * 3) as Array<{
    threadId: string;
    title: string | null;
    snippet: string;
    msgTs: number | null;
  }>;

  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of rows) {
    if (seen.has(r.threadId)) continue;
    seen.add(r.threadId);
    out.push({
      threadId: r.threadId,
      title: r.title,
      snippet: r.snippet,
      lastUpdated: Math.floor((r.msgTs ?? 0) * 1000),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function updateThreadTitle(profileId: string, threadId: string, title: string): boolean {
  const db = getDb(profileId);
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return false;
  const info = db
    .prepare(`UPDATE sessions SET title = ? WHERE id = ?`)
    .run(trimmed, threadId);
  return info.changes > 0;
}

export function deleteThread(profileId: string, threadId: string): boolean {
  const db = getDb(profileId);
  const txn = db.transaction((id: string) => {
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(id);
    const info = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return info.changes;
  });
  const changes = txn(threadId);
  // FTS rebuild pra não ficar com órfãos
  try {
    db.prepare(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`).run();
  } catch {
    // ignora — alguns schemas não suportam rebuild dinâmico
  }
  return changes > 0;
}

// ─── helpers ────────────────────────────────────────────────────────────

function deriveTitle(firstUserMsg: string | null): string | null {
  if (!firstUserMsg) return null;
  const cleaned = stripFormStateWrapper(firstUserMsg);
  if (!cleaned) return null;
  return cleaned.split(/\s+/).slice(0, 8).join(" ").slice(0, 100);
}

function derivePreview(firstUserMsg: string | null): string | null {
  if (!firstUserMsg) return null;
  const cleaned = stripFormStateWrapper(firstUserMsg);
  return cleaned ? cleaned.slice(0, 160) : null;
}

/**
 * Mensagens do waves_client vêm com `<content>...</content><context>[...]</context>`
 * (form submits). Pra título/preview, extrai o conteúdo amigável.
 */
function stripFormStateWrapper(raw: string): string {
  const m = raw.match(/<content>([\s\S]*?)<\/content>/);
  if (m && m[1]) return m[1].trim();
  // Triggers literais ficam mais legíveis
  if (raw === "__form_cnpj__") return "Consultar CNPJ";
  if (raw === "__form_cpf__") return "Consultar CPF";
  if (raw === "__form_cnpj_map__") return "Consultar MAP";
  return raw.trim();
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * SQLite FTS5 aceita query DSL. Pra não estourar com chars especiais:
 * - remove tudo que não é alfanumérico ou espaço/acento
 * - quebra em tokens, junta com ' AND '
 * - se nada sobra → null (caller skip)
 */
function sanitizeFtsQuery(query: string): string | null {
  const tokens = query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos pra match flexível
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  // wrap cada token em aspas pra prefix-match seguro
  return tokens.map((t) => `${t}*`).join(" AND ");
}
