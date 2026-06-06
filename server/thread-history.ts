/**
 * Histórico de conversas — via HTTP do gateway Hermes (apps DESACOPLADAS).
 *
 * O waves_client NÃO acessa mais o filesystem do Hermes (`state.db`). Lê/edita
 * sessões pelo gateway: `GET/PATCH/DELETE /api/sessions*` no host:port do agent
 * (vindo do login), autenticado com o Bearer do próprio usuário. Assim o client
 * pode rodar em outro server que o Hermes.
 *
 * Uma "thread" do waves_client = uma sessão Hermes cujo id segue
 * `waves-<tenant>-user-<id>::<threadId>` (ou legado sem `::`). O gateway devolve
 * TODAS as sessões do profile; filtramos client-side pelo prefixo do tenant
 * ativo (mesma regra do código antigo, agora aplicada sobre o JSON do gateway).
 */

const FETCH_TIMEOUT_MS = 15_000;

/** Contexto pra falar com o gateway de um profile (montado na rota Express). */
export interface GatewayCtx {
  /** Raiz do gateway — ex.: `http://127.0.0.1:18860` (SEM `/v1`, SEM `/api`). */
  root: string;
  /** Bearer do usuário (sem o prefixo `Bearer `). */
  token: string;
  /** `X-Hermes-Session-Id` — carrega o slug do tenant p/ a auth multi-tenant. */
  sessionId: string;
  /** Slug do tenant ativo — filtra as sessões do usuário. */
  tenantSlug: string;
}

export interface ThreadSummary {
  id: string;
  title: string | null;
  messageCount: number;
  lastUpdated: number; // epoch ms
  preview: string | null;
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

// ─── transporte ─────────────────────────────────────────────────────────

async function gw(
  ctx: GatewayCtx,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${ctx.token}`,
    "X-Hermes-Session-Id": ctx.sessionId,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${ctx.root}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ─── operações ──────────────────────────────────────────────────────────

interface GwSession {
  id?: string;
  title?: string | null;
  message_count?: number | null;
  started_at?: number | null;
  last_active?: number | null;
  preview?: string | null;
}

export async function listThreads(ctx: GatewayCtx, limit = 100): Promise<ThreadSummary[]> {
  // O gateway já ordena por last_active desc; 200 é o teto do endpoint.
  const r = await gw(ctx, "GET", `/api/sessions?limit=200&include_children=true`);
  if (!r.ok) throw new Error(`gateway GET /api/sessions → ${r.status}`);
  const j = (await r.json()) as { data?: GwSession[] };
  const rows = (j.data ?? []).filter(
    (s) =>
      typeof s?.id === "string" &&
      belongsToTenant(s.id, ctx.tenantSlug) &&
      (s.message_count ?? 0) > 0,
  );
  return rows.slice(0, limit).map((s) => ({
    id: s.id as string,
    title: s.title || deriveTitle(s.preview ?? null),
    messageCount: s.message_count ?? 0,
    lastUpdated: toMs(s.last_active ?? s.started_at),
    preview: derivePreview(s.preview ?? null),
  }));
}

interface GwMessage {
  id?: number | string;
  role?: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_name?: string | null;
  tool_call_id?: string | null;
  timestamp?: number | null;
}

export async function getThreadMessages(
  ctx: GatewayCtx,
  threadId: string,
): Promise<ThreadMessage[]> {
  const r = await gw(ctx, "GET", `/api/sessions/${encodeURIComponent(threadId)}/messages`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`gateway GET messages → ${r.status}`);
  const j = (await r.json()) as { data?: GwMessage[] };
  return (j.data ?? []).map((m) => ({
    id: typeof m.id === "number" ? m.id : Number(m.id) || 0,
    role: String(m.role ?? ""),
    content: m.content ?? "",
    toolCalls: normalizeToolCalls(m.tool_calls),
    toolName: m.tool_name ?? null,
    toolCallId: m.tool_call_id ?? null,
    timestamp: toMs(m.timestamp),
  }));
}

/**
 * Busca FTS real (Fase 3): usa o endpoint `/api/sessions-search` do gateway, que
 * varre o corpo completo das mensagens (FTS5) e devolve snippet com `<mark>`. O
 * gateway retorna matches de TODOS os tenants; filtramos pelo tenant ativo aqui.
 */
export async function searchThreads(
  ctx: GatewayCtx,
  query: string,
  limit = 50,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const r = await gw(
    ctx,
    "GET",
    `/api/sessions-search?q=${encodeURIComponent(q)}&limit=${limit * 3}`,
  );
  if (!r.ok) throw new Error(`gateway GET /api/sessions-search → ${r.status}`);
  const j = (await r.json()) as {
    data?: Array<{
      session_id?: string;
      title?: string | null;
      snippet?: string;
      timestamp?: number | null;
    }>;
  };
  const hits: SearchHit[] = [];
  for (const row of j.data ?? []) {
    const id = row.session_id;
    if (!id || !belongsToTenant(id, ctx.tenantSlug)) continue;
    hits.push({
      threadId: id,
      title: row.title ?? null,
      snippet: row.snippet ?? "",
      lastUpdated: toMs(row.timestamp),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function updateThreadTitle(
  ctx: GatewayCtx,
  threadId: string,
  title: string,
): Promise<boolean> {
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return false;
  const r = await gw(ctx, "PATCH", `/api/sessions/${encodeURIComponent(threadId)}`, {
    title: trimmed,
  });
  return r.ok;
}

export async function deleteThread(ctx: GatewayCtx, threadId: string): Promise<boolean> {
  const r = await gw(ctx, "DELETE", `/api/sessions/${encodeURIComponent(threadId)}`);
  return r.ok;
}

// ─── filtro de tenant ─────────────────────────────────────────────────────

/**
 * Sessões que pertencem ao tenant ativo: `waves-<tenant>-user-*` e
 * `waves-<tenant>-anon*`. Exclui api/cron/manuais e os OUTROS tenants. Mesma
 * regra do SQL antigo (`userSessionPattern`), agora sobre o id vindo do gateway.
 */
function belongsToTenant(id: string, slug: string): boolean {
  const t = slug.replace(/[^a-z0-9_-]/gi, "");
  return id.startsWith(`waves-${t}-user-`) || id.startsWith(`waves-${t}-anon`);
}

// ─── helpers ────────────────────────────────────────────────────────────

/** Timestamps do Hermes vêm em segundos (epoch) → ms. */
function toMs(sec: number | null | undefined): number {
  return Math.floor((Number(sec) || 0) * 1000);
}

function normalizeToolCalls(v: unknown): unknown[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const p = safeJSON(v);
    return Array.isArray(p) ? p : null;
  }
  return null;
}

function deriveTitle(preview: string | null): string | null {
  if (!preview) return null;
  const cleaned = stripFormStateWrapper(preview);
  if (!cleaned) return null;
  return cleaned.split(/\s+/).slice(0, 8).join(" ").slice(0, 100);
}

function derivePreview(preview: string | null): string | null {
  if (!preview) return null;
  const cleaned = stripFormStateWrapper(preview);
  return cleaned ? cleaned.slice(0, 160) : null;
}

/**
 * Mensagens do waves_client vêm com `<content>...</content><context>[...]</context>`
 * (form submits). Pra título/preview, extrai o conteúdo amigável.
 */
function stripFormStateWrapper(raw: string): string {
  const m = raw.match(/<content>([\s\S]*?)<\/content>/);
  if (m && m[1]) return m[1].trim();
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
