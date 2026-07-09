import "./load-env.js";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  getOpenAiCredential,
  getOpenAiBaseUrl,
  getOpenAiProvider,
  maskSecret,
} from "./load-env.js";
import { handleChatRequest, resolveHermesGateway } from "./chat.js";
import {
  getActiveTenant,
  getDefaultTenant,
  hostFromHeaders,
  isTenantResolved,
  resolveTenantByHost,
  runWithTenant,
} from "./tenants.js";
import {
  deleteThread,
  getThreadMessages,
  listThreads,
  searchThreads,
  updateThreadTitle,
  type GatewayCtx,
} from "./thread-history.js";
import { getProgress } from "./tool-progress.js";
import { allRenderedBases, rememberJobBackend, renderedUrlForJob } from "./specialist-jobs.js";
import { DEFAULT_OPENAI_MODEL } from "./waves-prompt.js";
import { loadOpenUISpec } from "./openui-spec.js";
import { uploadsRouter } from "./uploads.js";
import { exportRouter } from "./export.js";
import { analyzeRouter, analysisReportRouter } from "./analyze.js";
import { transcribeRouter } from "./transcribe.js";
import { ensureFilesDir, filesRouter } from "./files.js";
import {
  createNotification,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} from "./notifications.js";
import {
  isCacheableWaves,
  wavesCacheKey,
  getWavesCache,
  setWavesCache,
} from "./waves-cache.js";
import { getWavesUser, type WavesSession } from "./waves-client.js";
import { userIdFromBearer, isAdminFromBearer } from "./auth-user.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(ROOT_DIR, "dist");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

// Comparação de segredo em tempo (quase) constante — evita side-channel de
// timing em chaves de serviço. timingSafeEqual exige buffers do mesmo tamanho;
// em tamanho diferente comparamos contra si mesmo e retornamos false.
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// Exige um Bearer VÁLIDO (resolvido contra a Waves) — usado em endpoints que
// consomem recurso (transcribe/export via Whisper/weasyprint/docx) pra evitar
// abuso anônimo. Deriva o usuário do token; nunca confia em flag do cliente.
async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) {
    res.status(401).json({ error: "Autenticação necessária." });
    return;
  }
  next();
}

// Resolve o tenant pela ORIGEM da requisição (Host) e fixa no contexto (ALS)
// pra todo o request. Sem match → UNRESOLVED (via getDefaultTenant, que só honra
// DEFAULT_TENANT explícito) — NUNCA o 1º tenant nem WAVES_URL legado. Os
// consumidores (proxy /api/waves, /api/tenant) checam isTenantResolved e falham
// explicitamente em vez de servir a Waves/marca de outro tenant.
app.use((req, _res, next) => {
  const host = hostFromHeaders(req.headers);
  const tenant = resolveTenantByHost(host) ?? getDefaultTenant();
  runWithTenant(tenant, () => next());
});

// Branding do tenant da origem atual (logos + imagem de login). Público — o
// frontend (tela de login) consome antes de autenticar.
app.get("/api/tenant", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const tenant = getActiveTenant();
  // Host sem match → 404 (sem branding). NÃO devolve um default — o frontend
  // cai no fallback de marca neutra em vez de exibir a marca de outro tenant.
  if (!isTenantResolved(tenant)) {
    return res.status(404).json({ error: "Nenhum tenant configurado para este host." });
  }
  res.json(tenant.branding);
});

app.get("/api/health", (_req, res) => {
  const provider = getOpenAiProvider();
  let configured = false;
  let credPreview = "(não disponível)";
  let credError: string | undefined;
  try {
    const cred = getOpenAiCredential();
    configured = Boolean(cred);
    credPreview = maskSecret(cred);
  } catch (err) {
    credError = err instanceof Error ? err.message : String(err);
  }
  res.json({
    ok: true,
    openai: {
      provider,
      baseURL: getOpenAiBaseUrl() ?? "(default)",
      configured,
      credentialPreview: credPreview,
      credentialError: credError,
      model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    },
  });
});

// --- Proxy reverso pra Babble API ------------------------------------------
// Frontend bate em `/api/waves/<path>` (mesma origem, sem CORS) e nós
// refazemos pra `<url do tenant ativo>/<path>` server-side, injetando o
// X-API-KEY do tenant (resolvido via ACTIVE_TENANT + tenants.json).
// Authorization Bearer do user passa direto.

// Timeout do proxy Waves: se a Waves travar, não deixa o request pendurado
// segurando socket/handler. 30s cobre bem operações normais da API.
const WAVES_PROXY_TIMEOUT_MS = Number(process.env.WAVES_PROXY_TIMEOUT_MS || 30_000);

app.all(/^\/api\/waves(\/.*)?$/, async (req, res) => {
  const tenant = getActiveTenant();
  // Host sem tenant → 421 e PARA. Nunca encaminha pra uma Waves default/legacy
  // (serviria dados do tenant errado). Ou o host bate num tenant, ou falha.
  if (!isTenantResolved(tenant)) {
    const host = hostFromHeaders(req.headers) || "?";
    return res.status(421).json({
      error: `Host "${host}" não está mapeado a nenhum tenant. Configure em .secrets/tenants.json.`,
    });
  }
  let upstreamPath = req.url.replace(/^\/api\/waves/, "") || "/";
  // Escopo por AGENTE: a Waves filtra workflows/tasks pelo agent_id. O client manda
  // X-Agent-Id (agente ativo do login); anexamos ?agent_id= nessas rotas GET. Entra no
  // upstreamPath ANTES da cache key → não há colisão de cache entre agentes diferentes.
  const agentId = (req.headers["x-agent-id"] as string | undefined)?.trim();
  if (agentId && req.method === "GET") {
    const pathOnly = upstreamPath.split("?")[0];
    const scoped =
      pathOnly === "/workflows" || pathOnly.startsWith("/workflows/") ||
      pathOnly === "/openui/tools/workflows" || pathOnly.startsWith("/openui/tools/workflows/") ||
      pathOnly === "/openui/tools/tasks" || pathOnly.startsWith("/openui/tools/tasks/");
    if (scoped && !/[?&]agent_id=/.test(upstreamPath)) {
      upstreamPath +=
        (upstreamPath.includes("?") ? "&" : "?") + "agent_id=" + encodeURIComponent(agentId);
    }
  }
  const url = `${tenant.url}${upstreamPath}`;

  // Cache READ por usuário (combate 429): statistics/* e lista de workflows.
  const auth = req.headers.authorization as string | undefined;
  const cacheable = isCacheableWaves(req.method, upstreamPath);
  const ckey = cacheable ? wavesCacheKey(tenant.id, auth, upstreamPath) : "";
  if (cacheable) {
    const hit = getWavesCache(ckey);
    if (hit) {
      if (hit.contentType) res.setHeader("content-type", hit.contentType);
      res.setHeader("X-Waves-Cache", "HIT");
      return res.status(200).end(hit.body);
    }
  }

  const headers: Record<string, string> = {
    "X-API-KEY": tenant.key,
    Accept: "application/json",
  };
  if (auth) {
    headers.Authorization = auth;
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody) headers["Content-Type"] = "application/json";

  try {
    const init: RequestInit = {
      method: req.method,
      headers,
      // Não deixa o proxy pendurar indefinidamente se a Waves travar.
      signal: AbortSignal.timeout(WAVES_PROXY_TIMEOUT_MS),
    };
    if (hasBody) {
      init.body = JSON.stringify(req.body ?? {});
    }
    const upstream = await fetch(url, init);
    console.log(
      `[waves-proxy] ${req.method} ${upstreamPath} → ${upstream.status}${cacheable ? " (miss)" : ""}`,
    );
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (cacheable) setWavesCache(ckey, upstream.status, ct, buf);
    res.end(buf);
  } catch (err) {
    console.error(`[waves-proxy] ${req.method} ${url} →`, err);
    res.status(502).json({
      error: "Upstream Waves unreachable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- Runtime info (profile detectado + starters contextuais) -------------
// Permite o frontend mostrar conversation starters apropriados pro profile
// ativo. Profile inferido pela porta do HERMES_BASE_URL — sem hardcode no
// frontend. Pra novos profiles, edite PROFILE_STARTERS abaixo.
interface ProfileStarterFormField {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email";
  required?: boolean;
}

interface ProfileStarter {
  displayText: string;
  /** Prompt direto pro agente quando o starter NÃO tem form. */
  prompt: string;
  /** Quando presente, click abre form local. Submit dispara message. */
  formFields?: ProfileStarterFormField[];
  /** Template do prompt enviado após submit do form. `{{name}}` → valor. */
  submitPromptTemplate?: string;
}

const PROFILE_STARTERS: Record<string, ProfileStarter[]> = {
  "18860": [
    // Steve (BioShield CDMO) — starters fixos pras consultas mais comuns
    {
      displayText: "Action Plans abertos",
      prompt: "Liste todos os Action Plans abertos hoje, com responsável e estágio. Use dashboard visual.",
    },
    {
      displayText: "Status do projeto",
      prompt: "Me dá um overview do BIOSHIELD agora: fase, frentes ativas, próximos marcos.",
    },
    {
      displayText: "Tarefas críticas",
      prompt: "Quais são as tasks de maior prioridade ou em atraso nos Action Plans?",
    },
    {
      displayText: "Funil de captação",
      prompt: "Mostra o estado atual do funil de captação e investimento do projeto.",
    },
  ],
  "18862": [
    // ybrax-negative-media — Mídia Adversa (CPF + CNPJ)
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
  ],
  "18864": [
    // ybrax-verifique — hub YBRAX (Verifique + consultas). Dois starters:
    // o SOUL renderiza o form específico por tipo de documento.
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
  ],
};

const PROFILE_NAMES: Record<string, string> = {
  "18860": "bioshield-steve",
  "18862": "ybrax-negative-media",
  "18864": "ybrax-verifique",
};

const PROFILE_ID_TO_PORT: Record<string, string> = {
  "bioshield-steve": "18860",
  "ybrax-negative-media": "18862",
  "ybrax-verifique": "18864",
};

function detectProfile(requestedId?: string) {
  // Se o frontend pediu um profile específico (?profile=ybrax-map), respeita.
  // Caso contrário, fallback pro env HERMES_BASE_URL (default histórico).
  let port: string;
  if (requestedId && PROFILE_ID_TO_PORT[requestedId]) {
    port = PROFILE_ID_TO_PORT[requestedId];
  } else {
    const baseURL =
      process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:18862/v1";
    const m = baseURL.match(/:(\d+)/);
    port = m ? m[1] : "18862";
  }
  return {
    id: PROFILE_NAMES[port] ?? `unknown-${port}`,
    port,
    starters: PROFILE_STARTERS[port] ?? [],
  };
}

app.get("/api/runtime", (req, res) => {
  const requested = typeof req.query.profile === "string" ? req.query.profile : undefined;
  const profile = detectProfile(requested);
  res.json({
    provider: getOpenAiProvider(),
    profile: profile.id,
    port: profile.port,
    defaultStarters: profile.starters,
    model:
      process.env.HERMES_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  });
});


// ─── Histórico de conversas (threads) ──────────────────────────────────
// Apps DESACOPLADAS: o client NÃO toca o filesystem do Hermes. Estas rotas
// falam com o gateway do agent (host:port do login) por HTTP, autenticadas com
// o Bearer do próprio usuário. O `GatewayCtx` é montado a partir da request.

function buildThreadCtx(
  authHeader: string | undefined,
  host: unknown,
  port: unknown,
):
  | { ok: true; ctx: GatewayCtx }
  | { ok: false; status: number; error: string } {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return { ok: false, status: 401, error: "Bearer ausente." };
  const gw = resolveHermesGateway(
    host ? String(host) : undefined,
    port != null ? Number(port) : undefined,
  );
  if (!gw.ok) return { ok: false, status: gw.status, error: gw.error };
  // baseURL vem com /v1 (chat); os endpoints de sessão ficam na raiz (/api/...).
  const root = gw.baseURL.replace(/\/v1$/, "");
  const slug = getActiveTenant().id;
  // session-id carrega só o SLUG (p/ a auth multi-tenant resolver o tenant); a
  // lista é filtrada pelo prefixo do tenant. O uid é NÃO-numérico ("ro") de
  // propósito: o `_persist_web_session` do gateway só grava quando casa
  // `user-\d+`, então estes reads de histórico NÃO disparam escrita de
  // web-session (o chat já mantém o token fresco) — zero I/O extra no gateway.
  return { ok: true, ctx: { root, token, sessionId: `waves-${slug}-user-ro`, tenantSlug: slug } };
}

app.get("/api/threads", async (req, res) => {
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  try {
    const threads = await listThreads(b.ctx, 200);
    res.json({ threads });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/threads/search", async (req, res) => {
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  const q = String(req.query.q ?? "");
  try {
    const hits = await searchThreads(b.ctx, q, 50);
    res.json({ hits });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/threads/:id/messages", async (req, res) => {
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  try {
    const messages = await getThreadMessages(b.ctx, req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/api/threads/:id", async (req, res) => {
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  const title = String((req.body as { title?: unknown })?.title ?? "");
  if (!title.trim()) return res.status(400).json({ error: "title required" });
  try {
    const ok = await updateThreadTitle(b.ctx, req.params.id, title);
    res.json({ ok });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/threads/:id", async (req, res) => {
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  try {
    const ok = await deleteThread(b.ctx, req.params.id);
    res.json({ ok });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Notificações (o "sino") -------------------------------------------------
// Escopo por (profile, user_id) — o front passa ambos. Base p/ Task 722 (alerta
// de task atribuída) e Task 724 (compartilhamento de arquivo). O sino polla o GET.
// tenant derivado do HOST (não do cliente) — isolamento multi-tenant.
const notifTenant = () => getActiveTenant().id;

app.get("/api/notifications", async (req, res) => {
  const profile = String(req.query.profile ?? "");
  const userId = String(req.query.user_id ?? "");
  if (!profile || !userId) return res.status(400).json({ error: "profile and user_id required" });
  // AUTH: só lê as PRÓPRIAS notificações (o user_id vem do token, não da query).
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) return res.status(401).json({ error: "Autenticação necessária." });
  if (String(me) !== userId) return res.status(403).json({ error: "Sem permissão." });
  try {
    const tenant = notifTenant();
    res.json({
      notifications: listNotifications(tenant, profile, userId, 50),
      unread: unreadCount(tenant, profile, userId),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Criar notificação (uso interno: atribuição de task / compartilhamento criam via
// createNotification server-side). HTTP exige usuário autenticado (anti-spam).
app.post("/api/notifications", async (req, res) => {
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) return res.status(401).json({ error: "Autenticação necessária." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const profile = String(b.profile ?? "");
  const userId = String(b.user_id ?? "");
  const title = String(b.title ?? "");
  if (!profile || !userId || !title)
    return res.status(400).json({ error: "profile, user_id, title required" });
  // AUTH: só cria notificação PRA SI MESMO (o user_id tem que bater com o token).
  // Notificação pra OUTRO usuário é server-side (createNotification em share/files)
  // ou server-to-server (/api/notifications/ingest com X-Ingest-Key).
  if (userId !== String(me)) return res.status(403).json({ error: "Sem permissão." });
  try {
    const id = createNotification({
      tenant: notifTenant(),
      profile,
      userId,
      type: b.type ? String(b.type) : undefined,
      title,
      body: b.body != null ? String(b.body) : undefined,
      data: b.data,
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Ingest server-to-server (pipeline do Hermes: notify_task_user) — autenticado por
// SERVICE-KEY (X-Ingest-Key = NOTIFY_INGEST_KEY), pois o caller NÃO tem Bearer de
// usuário. `tenant` vem EXPLÍCITO no corpo (não há host/ALS numa chamada de servidor).
// Doutrina §1: Hermes só entrega por HTTP, nunca escreve o notifications.db direto.
app.post("/api/notifications/ingest", async (req, res) => {
  const expected = (process.env.NOTIFY_INGEST_KEY ?? "").trim();
  const key = String(req.headers["x-ingest-key"] ?? "").trim();
  if (!expected || !safeEqual(key, expected))
    return res.status(401).json({ error: "ingest key inválida ou ausente." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const tenant = String(b.tenant ?? "");
  const profile = String(b.profile ?? "");
  const userId = String(b.user_id ?? "");
  const title = String(b.title ?? "");
  if (!tenant || !profile || !userId || !title)
    return res.status(400).json({ error: "tenant, profile, user_id, title required" });
  try {
    const id = createNotification({
      tenant,
      profile,
      userId,
      type: b.type ? String(b.type) : undefined,
      title,
      body: b.body != null ? String(b.body) : undefined,
      data: b.data,
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/notifications/read-all", async (req, res) => {
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) return res.status(401).json({ error: "Autenticação necessária." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const profile = String(b.profile ?? req.query.profile ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  res.json({ updated: markAllRead(notifTenant(), profile, String(me)) });
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) return res.status(401).json({ error: "Autenticação necessária." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const profile = String(b.profile ?? req.query.profile ?? "");
  if (!profile) return res.status(400).json({ error: "profile required" });
  res.json({ ok: markRead(notifTenant(), profile, String(me), Number(req.params.id)) });
});

// Destinatários p/ compartilhar arquivo: usuários que já logaram NESTE agente
// (web-sessions do profile). Exige usuário autenticado.
app.get("/api/share-recipients", async (req, res) => {
  // Apps DESACOPLADAS: não lê mais o web-sessions do FS do Hermes — pergunta ao
  // gateway (GET /api/web-users), que conhece os usuários daquele profile.
  const b = buildThreadCtx(req.headers.authorization as string | undefined, req.query.host, req.query.port);
  if (!b.ok) return res.status(b.status).json({ error: b.error });
  try {
    const r = await fetch(`${b.ctx.root}/api/web-users`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${b.ctx.token}`,
        "X-Hermes-Session-Id": b.ctx.sessionId,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return res.status(502).json({ recipients: [], error: `gateway /api/web-users → ${r.status}` });
    const j = (await r.json()) as { data?: Array<{ user_id?: string; name?: string }> };
    const recipients = (j.data ?? [])
      .map((u) => ({ user_id: String(u.user_id ?? ""), name: String(u.name ?? "") }))
      .filter((u) => u.user_id);
    res.json({ recipients });
  } catch {
    res.json({ recipients: [] });
  }
});

// Compartilhar um DOCUMENTO da Waves (já registrado — temos o document_id).
// Diferente do /api/files: o doc vive na Waves; o destinatário acessa o PDF com
// o token DELE (permissão governada pela Waves). Aqui validamos o remetente e
// criamos a notificação `file_shared` (com document_id) no sino do destinatário.
app.post("/api/documents/:docId/share", async (req, res) => {
  const authHeader = req.headers.authorization as string | undefined;
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  if (!token) return res.status(401).json({ error: "Bearer ausente." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const toUserId = Number(b.to_user_id);
  const profile = String(b.profile ?? "");
  const fileName = String(b.file_name ?? "Documento");
  if (!toUserId || !profile) {
    return res.status(400).json({ error: "to_user_id e profile obrigatórios." });
  }
  let fromName = "Alguém";
  try {
    const env = (req.query.env === "dev" ? "dev" : "prod") as WavesSession["environment"];
    const user = (await getWavesUser({ environment: env, accessToken: token })) as {
      id: number;
      name?: string;
      email?: string;
    };
    fromName = user.name || user.email || `Usuário ${user.id}`;
  } catch {
    return res.status(401).json({ error: "Token inválido." });
  }
  createNotification({
    tenant: getActiveTenant().id,
    profile,
    userId: toUserId,
    type: "file_shared",
    title: `${fromName} compartilhou um documento`,
    body: fileName,
    data: {
      document_id: req.params.docId,
      file_name: fileName,
      mime: "application/pdf",
      from: fromName,
    },
  });
  res.json({ ok: true });
});

// Progress da tool em execução no Hermes — frontend polla durante o stream
// pra mostrar no ThinkingIndicator. Retorna null quando nada está em
// execução ou quando o último progress está stale (>10s).
// Escopo POR SESSÃO: o progress é keyed pelo sessionId do Hermes
// (`waves-<tenant>-user-<id>::<thread>`). Reconstruímos a MESMA chave a partir
// do Bearer (user id) + tenant (host/ALS) + `?thread=` — assim um usuário só
// enxerga o próprio progresso (não vaza entre chats/usuários concorrentes).
app.get("/api/chat/progress", async (req, res) => {
  const thread = String(req.query.thread ?? "").trim();
  if (!thread) return res.json({ progress: null });
  const me = await userIdFromBearer(req.headers.authorization as string | undefined);
  if (me == null) return res.json({ progress: null });
  const sessionKey = `waves-${getActiveTenant().id}-user-${me}::${thread}`;
  res.json({ progress: getProgress(sessionKey) });
});

// --- Proxy pra rendered_api (specialist jobs em openui-lang) ---------------
// Frontend polla `/api/specialist-jobs/:id/rendered` enquanto o sub-agent
// (Vigia/Cronos/etc.) ainda está processando. Encaminhamos pro daemon
// Python em :18861, que devolve `{status, openui_lang?, eta_s?, error?}`.
// Detalhes em ~/.hermes/shared-knowledge/bioshield/specialist_jobs/rendered_api.py
const RENDERED_API_BASE = (
  process.env.RENDERED_API_URL ?? "http://127.0.0.1:18861"
).replace(/\/+$/, "");
// Jobs de SUPORTE (`support-<task_id>`) vão pra um rendered_api próprio que lê a
// task wf56 (support_rendered_api.py). Roteamento por prefixo — generaliza o
// proxy sem acoplar ao rendered_api do Steve (:18861).
const SUPPORT_RENDERED_BASE = (
  process.env.SUPPORT_RENDERED_URL ?? "http://127.0.0.1:18882"
).replace(/\/+$/, "");

app.get("/api/specialist-jobs/:id/rendered", async (req, res) => {
  const jobId = req.params.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return res.status(400).json({ error: "job_id inválido" });
  }
  // Resolução do rendered_api correto:
  // 1) backend aprendido na injeção do marcador (rota por assistente/tenant) → 1 candidato;
  // 2) jobs de suporte (`support-<task_id>`) → rendered de suporte;
  // 3) caso contrário (map-miss: ex. após restart) → sonda as bases conhecidas
  //    (default primeiro) e fica na 1ª que CONHECE o job; cacheia o vencedor.
  const learned = renderedUrlForJob(jobId);
  const candidates = learned
    ? [learned]
    : jobId.startsWith("support")
      ? [SUPPORT_RENDERED_BASE]
      : Array.from(new Set([RENDERED_API_BASE, ...allRenderedBases()]));
  let last: { status: number; ct: string; text: string } | null = null;
  for (const base of candidates) {
    try {
      const upstream = await fetch(
        `${base}/specialist-jobs/${encodeURIComponent(jobId)}/rendered`,
        { signal: AbortSignal.timeout(150_000) },
      );
      const text = await upstream.text();
      const ct = upstream.headers.get("content-type") ?? "application/json";
      last = { status: upstream.status, ct, text };
      // Backend que CONHECE o job? (200 e não "not_found") → cacheia e encerra.
      if (upstream.ok && !/"status"\s*:\s*"not_found"/.test(text)) {
        if (!learned) rememberJobBackend(jobId, base);
        break;
      }
    } catch (err) {
      // Base offline/timeout — tenta a próxima; só vira 502 se TODAS falharem.
      const msg = err instanceof Error ? err.message : "rendered_api offline";
      last = last ?? {
        status: 502,
        ct: "application/json",
        text: JSON.stringify({ status: "proxy_error", error: `rendered_api unreachable: ${msg}` }),
      };
    }
  }
  if (last) {
    res.status(last.status);
    res.set("Content-Type", last.ct);
    res.send(last.text);
  } else {
    res.status(502).json({ status: "proxy_error", error: "nenhum rendered_api respondeu" });
  }
});

// --- Proxy pro hermes-graph-api (Architecture Explorer #848) ---------------
// Desacoplado (§1): o waves_client NÃO lê o FS do Hermes — proxia o registry.json
// servido pelo serve.py em :18820 (mesmo padrão do rendered_api). ?refresh=1 força
// re-scan no lado Hermes.
const GRAPH_API_BASE = (process.env.GRAPH_API_URL ?? "http://127.0.0.1:18820").replace(/\/+$/, "");
app.get("/api/architecture/graph", async (req, res) => {
  // #848 — ADMIN-ONLY: o grafo expõe estrutura interna (profiles/MCPs/workers/
  // patches/tenants). Admin derivado do Bearer (auth-user), nunca de query.
  if (!(await isAdminFromBearer(req.headers.authorization as string | undefined))) {
    return res.status(403).json({ error: "Apenas administradores podem ver os grafos." });
  }
  const qs = req.query.refresh === "1" ? "?refresh=1" : "";
  try {
    const upstream = await fetch(`${GRAPH_API_BASE}/architecture/graph${qs}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `graph-api unreachable: ${msg}` });
  }
});

// --- Proxy SSE pro hermes-graph-api (Architecture Explorer #858) -----------
// SSE de atividade dos agentes em tempo real. Admin-only. O servidor mantém a
// conexão aberta e repassa os eventos do serve.py (collector → events.jsonl).
app.get("/api/architecture/stream", async (req, res) => {
  if (!(await isAdminFromBearer(req.headers.authorization as string | undefined))) {
    return res.status(403).json({ error: "Apenas administradores podem ver os grafos." });
  }
  // SSE headers
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  try {
    const upstream = await fetch(`${GRAPH_API_BASE}/architecture/stream`, {
      signal: req.socket.destroyed ? AbortSignal.abort() : AbortSignal.timeout(3_600_000),
    });
    if (!upstream.ok || !upstream.body) {
      res.write(`event: error\ndata: {"error":"upstream ${upstream.status}"}\n\n`);
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done || req.socket.destroyed) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    };
    await pump();
  } catch (err) {
    if (!req.socket.destroyed) {
      res.write(`event: error\ndata: {"error":"${err instanceof Error ? err.message : "unknown"}"}\n\n`);
    }
  }
  res.end();
});

// --- Proxy activity snapshot (Architecture Explorer #858) ------------------
app.get("/api/architecture/activity", async (req, res) => {
  if (!(await isAdminFromBearer(req.headers.authorization as string | undefined))) {
    return res.status(403).json({ error: "Apenas administradores." });
  }
  const qs = req.query.refresh === "1" ? "?refresh=1" : "";
  try {
    const upstream = await fetch(`${GRAPH_API_BASE}/architecture/activity${qs}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const text = await upstream.text();
    res.status(upstream.status).set("Content-Type", "application/json").send(text);
  } catch (err) {
    res.status(502).json({ error: `graph-api unreachable: ${err instanceof Error ? err.message : "unknown"}` });
  }
});

// --- Export message as PDF or DOCX -------------------------------------------
app.post("/api/export-message", requireAuth, async (req, res) => {
  const { format, html, text } = req.body ?? {};
  if (!format || (!html && !text)) {
    return res.status(400).json({ error: "format + html/text required" });
  }

  try {
    if (format === "pdf") {
      // Use puppeteer-lite or simple HTML-to-PDF via headless chrome
      const { execSync } = await import("node:child_process");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");

      const tmpHtml = path.join(os.tmpdir(), `export-${Date.now()}.html`);
      const tmpPdf = tmpHtml.replace(".html", ".pdf");

      const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @page { size: A4; margin: 2cm; }
  body { font-family: 'Inter', system-ui, sans-serif; padding: 24px; color: #1e293b; line-height: 1.6; max-width: 100%; font-size: 11pt; }
  h1 { font-size: 20pt; font-weight: 700; color: #0f172a; border-bottom: 2px solid #6366f1; padding-bottom: 6px; }
  h2 { font-size: 15pt; font-weight: 600; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 20px; }
  h3 { font-size: 12pt; font-weight: 600; color: #334155; margin-top: 16px; }
  p { margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th { background: #f1f5f9; font-weight: 600; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.03em; padding: 8px 10px; text-align: left; border: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  code { background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-size: 9pt; }
  pre { background: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 9pt; }
  ul, ol { margin: 6px 0 6px 18px; }
  li { margin: 3px 0; }
  strong { color: #0f172a; }
  blockquote { border-left: 3px solid #6366f1; background: #f0f4ff; padding: 10px 14px; margin: 10px 0; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 16px 0; }
  /* Cards e badges do OpenUI renderizado */
  [class*="card"], [class*="Card"] { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 8px 0; }
  [class*="badge"], [class*="Badge"] { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9pt; font-weight: 600; }
  [class*="alert"], [class*="Alert"] { padding: 10px 14px; border-radius: 6px; margin: 8px 0; border-left: 4px solid; }
  /* Checkbox lists */
  input[type="checkbox"] { margin-right: 6px; }
</style></head><body>${html || `<pre>${text}</pre>`}</body></html>`;

      fs.writeFileSync(tmpHtml, fullHtml);

      // Use weasyprint (reliable, no dbus issues)
      execSync(
        `/home/bot/.hermes/hermes-agent/venv/bin/python -c "from weasyprint import HTML; HTML(filename='${tmpHtml}').write_pdf('${tmpPdf}')"`,
        { timeout: 15000 },
      );

      if (fs.existsSync(tmpPdf)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=mensagem.pdf");
        res.send(fs.readFileSync(tmpPdf));
        fs.unlinkSync(tmpHtml);
        fs.unlinkSync(tmpPdf);
      } else {
        res.status(500).json({ error: "PDF generation failed" });
      }
    } else if (format === "docx") {
      // Generate DOCX from HTML via python (html→docx with formatting)
      const { execSync } = await import("node:child_process");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");

      const tmpHtmlDoc = path.join(os.tmpdir(), `export-${Date.now()}.html`);
      const tmpDocx = tmpHtmlDoc.replace(".html", ".docx");
      const tmpPy = tmpHtmlDoc.replace(".html", ".py");

      // Write HTML content
      fs.writeFileSync(tmpHtmlDoc, html || text || "", "utf-8");

      // Use html2docx.py (handles inline styles, colors, badges, tables)
      const html2docxScript = path.join(process.cwd(), "server", "html2docx.py");
      if (fs.existsSync(html2docxScript)) {
        execSync(
          `/home/bot/.hermes/hermes-agent/venv/bin/python ${html2docxScript} ${tmpHtmlDoc} ${tmpDocx}`,
          { timeout: 15000 },
        );
        if (fs.existsSync(tmpDocx)) {
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          res.setHeader("Content-Disposition", "attachment; filename=mensagem.docx");
          res.send(fs.readFileSync(tmpDocx));
          try { fs.unlinkSync(tmpHtmlDoc); fs.unlinkSync(tmpDocx); } catch {}
          return;
        }
      }

      // Fallback: inline script
      const pyScript = `
import sys, re
from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

try:
    from bs4 import BeautifulSoup
except ImportError:
    # Fallback: strip tags and use plain text
    html_raw = Path('${tmpHtmlDoc}').read_text(encoding='utf-8')
    text = re.sub(r'<[^>]+>', '', html_raw)
    doc = Document()
    doc.styles['Normal'].font.name = 'Calibri'
    doc.styles['Normal'].font.size = Pt(11)
    for line in text.split('\\n'):
        line = line.strip()
        if line:
            doc.add_paragraph(line)
    doc.save('${tmpDocx}')
    sys.exit(0)

html_raw = Path('${tmpHtmlDoc}').read_text(encoding='utf-8')
soup = BeautifulSoup(html_raw, 'html.parser')

doc = Document()
style = doc.styles['Normal']
style.font.name = 'Calibri'
style.font.size = Pt(11)

def add_formatted_text(paragraph, element):
    """Recursively add formatted text from HTML element."""
    for child in element.children:
        if isinstance(child, str):
            text = child.strip()
            if text:
                paragraph.add_run(text)
        elif child.name == 'strong' or child.name == 'b':
            run = paragraph.add_run(child.get_text())
            run.bold = True
        elif child.name == 'em' or child.name == 'i':
            run = paragraph.add_run(child.get_text())
            run.italic = True
        elif child.name == 'code':
            run = paragraph.add_run(child.get_text())
            run.font.name = 'Consolas'
            run.font.size = Pt(9)
        elif child.name == 'br':
            paragraph.add_run('\\n')
        elif child.name == 'span':
            add_formatted_text(paragraph, child)
        else:
            text = child.get_text().strip()
            if text:
                paragraph.add_run(text)

def process_element(el):
    """Process an HTML element into docx."""
    if isinstance(el, str):
        text = el.strip()
        if text:
            doc.add_paragraph(text)
        return

    tag = getattr(el, 'name', None)
    if not tag:
        return

    if tag in ('h1', 'h2', 'h3', 'h4'):
        level = int(tag[1])
        doc.add_heading(el.get_text().strip(), level=level)

    elif tag == 'p':
        p = doc.add_paragraph()
        add_formatted_text(p, el)

    elif tag == 'ul':
        for li in el.find_all('li', recursive=False):
            p = doc.add_paragraph(style='List Bullet')
            add_formatted_text(p, li)

    elif tag == 'ol':
        for li in el.find_all('li', recursive=False):
            p = doc.add_paragraph(style='List Number')
            add_formatted_text(p, li)

    elif tag == 'table':
        rows = el.find_all('tr')
        if not rows:
            return
        # Count columns
        first_row = rows[0]
        cols = first_row.find_all(['th', 'td'])
        if not cols:
            return
        table = doc.add_table(rows=0, cols=len(cols))
        table.style = 'Table Grid'
        for tr in rows:
            cells = tr.find_all(['th', 'td'])
            row = table.add_row()
            for i, cell in enumerate(cells):
                if i < len(row.cells):
                    row.cells[i].text = cell.get_text().strip()
                    # Bold headers
                    if cell.name == 'th':
                        for p in row.cells[i].paragraphs:
                            for run in p.runs:
                                run.bold = True

    elif tag == 'blockquote':
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.5)
        add_formatted_text(p, el)
        for run in p.runs:
            run.italic = True

    elif tag == 'pre':
        p = doc.add_paragraph()
        run = p.add_run(el.get_text())
        run.font.name = 'Consolas'
        run.font.size = Pt(9)

    elif tag == 'hr':
        doc.add_paragraph('_' * 50)

    elif tag in ('div', 'section', 'article', 'main', 'body', 'html'):
        for child in el.children:
            process_element(child)

    elif tag == 'input' and el.get('type') == 'checkbox':
        checked = '☑' if el.get('checked') is not None else '☐'
        # Will be picked up by parent
        pass

    else:
        text = el.get_text().strip()
        if text and tag not in ('script', 'style', 'button', 'svg', 'path'):
            p = doc.add_paragraph()
            add_formatted_text(p, el)

# Process
for child in soup.children:
    process_element(child)

doc.save('${tmpDocx}')
`;
      fs.writeFileSync(tmpPy, pyScript);

      execSync(
        `/home/bot/.hermes/hermes-agent/venv/bin/python ${tmpPy}`,
        { timeout: 15000 },
      );

      if (fs.existsSync(tmpDocx)) {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", "attachment; filename=mensagem.docx");
        res.send(fs.readFileSync(tmpDocx));
        try { fs.unlinkSync(tmpHtmlDoc); fs.unlinkSync(tmpPy); fs.unlinkSync(tmpDocx); } catch {}
      } else {
        res.status(500).json({ error: "DOCX generation failed" });
      }
    } else {
      res.status(400).json({ error: "format must be pdf or docx" });
    }
  } catch (err) {
    res.status(500).json({ error: `Export failed: ${err instanceof Error ? err.message : "unknown"}` });
  }
});

// --- Proxy token consumption (Token Dashboard #852) -------------------------
app.get("/api/architecture/tokens", async (req, res) => {
  if (!(await isAdminFromBearer(req.headers.authorization as string | undefined))) {
    return res.status(403).json({ error: "Apenas administradores." });
  }
  const days = req.query.days || "30";
  try {
    const upstream = await fetch(`${GRAPH_API_BASE}/architecture/tokens?days=${days}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    res.status(upstream.status).set("Content-Type", "application/json").send(text);
  } catch (err) {
    res.status(502).json({ error: `graph-api unreachable: ${err instanceof Error ? err.message : "unknown"}` });
  }
});

// --- Spec OpenUI da Waves (cache 5min server-side) ------------------------
app.get("/api/openui/spec", async (_req, res) => {
  try {
    const spec = await loadOpenUISpec();
    res.json(spec);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "spec unavailable",
    });
  }
});

// --- Upload de arquivos do chat (multipart) --------------------------------
// POST /api/uploads → salva + extrai texto. GET /api/uploads/:id → original.
app.use("/api/uploads", uploadsRouter);

// --- Export do documento em Word (.doc) / HTML (PDF é nativo da Waves) -------
app.use("/api/export", requireAuth, exportRouter);

// --- Análise descritiva (modo analítico do relatório) → modelo do agente -----
app.use("/api/analyze-report", analyzeRouter);
// Relatório analítico/custom escrito pela IA (focado na instrução do usuário).
app.use("/api/analysis-report", analysisReportRouter);
// Transcrição de áudio via Whisper local (botão de microfone no composer).
app.use("/api/transcribe", requireAuth, transcribeRouter);

// --- Arquivos enviados PELO AGENTE pro usuário (download seguro) ------------
// GET /api/files/:id (auth Bearer + ownership + attachment). POST /api/files.
ensureFilesDir();
app.use("/api/files", filesRouter);

app.post("/api/chat", async (req, res) => {
  try {
    // wantUsage (contagem de tokens no stream) é admin-only. Deriva do Bearer —
    // nunca confia na flag do body. Não-admin: descarta a flag silenciosamente.
    if (req.body && (req.body as { wantUsage?: unknown }).wantUsage) {
      const admin = await isAdminFromBearer(req.headers.authorization as string | undefined);
      if (!admin) (req.body as { wantUsage?: boolean }).wantUsage = false;
    }
    const response = await handleChatRequest(req.body);
    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Erro interno no chat.",
    });
  }
});

// Logout: evicta o token do cache de cada gateway do usuário (host+port vindos
// do login) e revoga o token na Waves. Best-effort — falha por-gateway não bloqueia.
app.post("/api/logout", async (req, res) => {
  const body = (req.body ?? {}) as {
    token?: string;
    gateways?: Array<{ host?: string; port?: number }>;
  };
  const token = typeof body.token === "string" ? body.token : "";
  const gateways = Array.isArray(body.gateways) ? body.gateways : [];
  if (!token) {
    return res.status(400).json({ error: "token ausente" });
  }
  // Resolve o tenant direto do Host do request (não via ALS — handler async).
  const tenant = resolveTenantByHost(hostFromHeaders(req.headers)) ?? null;
  // 1) Evict em cada gateway (loopback por padrão; mesma resolução do chat).
  await Promise.allSettled(
    gateways.map(async (g) => {
      const gw = resolveHermesGateway(g.host, g.port);
      if (!gw.ok) return;
      await fetch(`${gw.baseURL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
    }),
  );
  // 2) Revoga o token na Waves (tenant resolvido por host).
  try {
    if (tenant && isTenantResolved(tenant) && tenant.url) {
      const r = await fetch(`${tenant.url}/logout`, {
        method: "POST",
        headers: {
          "X-API-KEY": tenant.key ?? "",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) console.warn(`[logout] Waves revoke → HTTP ${r.status}`);
    } else {
      console.warn("[logout] tenant não resolvido — revoke pulado");
    }
  } catch (e) {
    console.warn(`[logout] Waves revoke falhou: ${e instanceof Error ? e.message : e}`);
  }
  res.json({ ok: true });
});

// --- Serve static build (SPA) ----------------------------------------------
// Quando `dist/` existe (build feito), Express serve os assets E faz fallback
// pra index.html nas rotas client-side (/, /login, /chat, etc.). Sem build, só
// /api/* funciona — use `npm run dev` pra ter Vite servindo + HMR.
const hasBuild = existsSync(resolve(DIST_DIR, "index.html"));

if (hasBuild) {
  // Cache strategy:
  //
  // - `index.html` (entry da SPA): NUNCA cachear. Browser sempre puxa a
  //   versão atual, que referencia o bundle JS com hash atual. Garante
  //   que mobile/desktop peguem updates sem precisar de hard refresh.
  //
  // - Assets com hash no nome (`index-XXXXXXXX.js`, `*.css`, etc., gerados
  //   pelo vite/rollup): imutáveis — o nome muda quando o conteúdo muda.
  //   Pode cachear "forever" (1 ano) sem risco de servir versão velha.
  app.use(
    express.static(DIST_DIR, {
      index: false, // /api/* tem prioridade
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate",
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        } else {
          // Vite gera hash no nome (ex: index-D1OtG82D.js); cacheia 1 ano
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        }
      },
    }),
  );

  // SPA fallback: qualquer rota não-api devolve o index.html (React Router cuida).
  // Headers de no-cache pra garantir que o entry sempre venha fresco.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (req.method !== "GET") return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(resolve(DIST_DIR, "index.html"));
  });
}

app.listen(port, () => {
  const provider = getOpenAiProvider();
  const baseURL = getOpenAiBaseUrl() ?? "(default)";
  let credDesc: string;
  try {
    credDesc = `configurada (${maskSecret(getOpenAiCredential())})`;
  } catch (err) {
    credDesc = `ERRO: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(`Chat server listening on http://localhost:${port}`);
  console.log(`OpenAI provider: ${provider}  baseURL: ${baseURL}`);
  console.log(`Credential: ${credDesc}`);
  console.log(`Model: ${process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL}`);
  console.log(
    hasBuild
      ? `SPA: servindo ${DIST_DIR} (acessa /, /login, /chat pela mesma porta)`
      : `SPA: dist/ ausente — só /api/* funciona. Roda \`npm run build\` ou \`npm run dev\` (vite separado).`,
  );
});
