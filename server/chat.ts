import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  getOpenAiCredential,
  getOpenAiBaseUrl,
  getOpenAiProvider,
} from "./load-env.js";
import {
  buildCodexClient,
  runCodexChat,
  toolsToResponsesFormat,
  type CodexTool,
} from "./codex-client.js";
import {
  ensureFollowUps,
  extractWorkflowIdFromToolCalls,
} from "./openui-postprocess.js";
import {
  buildWavesPromptForHermes,
  buildWavesSystemPrompt,
  DEFAULT_OPENAI_MODEL,
} from "./waves-prompt.js";
import {
  getAssistantFunnel,
  getBookingAvailableDates,
  getBookingAvailableSlots,
  getTask,
  getWorkflow,
  getWorkflowKanban,
  getWorkflowStatistics,
  getWorkflowTasks,
  listAppointments,
  listWorkflows,
  type WavesSession,
  type WorkflowStatisticsMetric,
} from "./waves-client.js";
import {
  buildOpenAIToolsFromSpec,
  loadOpenUISpec,
} from "./openui-spec.js";
import { getActiveTenant } from "./tenants.js";
import { buildDynamicExamples } from "./dynamic-examples.js";
import { getDemoReport } from "./demo-reports.js";
import {
  getCached as getFormCached,
  isCacheableTrigger,
  setCached as setFormCached,
} from "./form-cache.js";
// Hosts de gateway Hermes permitidos além do loopback. Vazio (default) → só
// 127.0.0.1 (deployment co-locado: gateways fazem bind em loopback e o login
// anuncia IP público, que NÃO é roteável pelo proxy local). Quando o Hermes for
// remoto de verdade, listar os hosts aqui (CSV) pra usar o host do login.
const HERMES_ALLOWED_HOSTS = new Set(
  (process.env.HERMES_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Loopback é sempre permitido (deploy co-locado, default). Demais hosts só via
// allowlist explícita.
const HERMES_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// Hostname seguro: letras/dígitos/`.`/`-` (DNS) ou IPv4. NÃO casa `@`, `/`, `:`,
// espaço — caracteres que permitiriam subverter a URL (userinfo, path, porta
// embutida) e desviar a request pra outro destino.
const SAFE_HOSTNAME = /^[a-zA-Z0-9.-]+$/;

/** Resolve o gateway Hermes a partir do host+port do LOGIN (sem lista hardcoded).
 *  Anti-SSRF (defesa-em-profundidade): porta válida + host só fora do loopback se
 *  estiver na allowlist + forma de hostname segura + a baseURL final é re-parseada
 *  com `new URL()` e re-conferida (protocolo http, hostname permitido, porta bate).
 *  Assim, mesmo que a montagem mude no futuro, o destino nunca escapa do esperado. */
export function resolveHermesGateway(
  host?: string,
  port?: number,
):
  | { ok: true; baseURL: string }
  | { ok: false; status: number; error: string } {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { ok: false, status: 400, error: `Porta de gateway inválida: ${String(port)}` };
  }
  const h = (host || "").trim().toLowerCase();
  // Host do login só é honrado se: forma segura E na allowlist. Qualquer outra
  // coisa (vazio, malformado, não-listado) → loopback. Nunca um host arbitrário.
  const allowed = h && SAFE_HOSTNAME.test(h) && HERMES_ALLOWED_HOSTS.has(h);
  const useHost = allowed ? h : "127.0.0.1";
  const baseURL = `http://${useHost}:${p}/v1`;

  // Re-valida o resultado final. `useHost` já é restrito, mas re-parsear garante
  // que nenhum caractere inesperado sobreviveu à montagem (defesa-em-profundidade).
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return { ok: false, status: 400, error: "baseURL de gateway inválida" };
  }
  const hostOk =
    HERMES_LOOPBACK_HOSTS.has(parsed.hostname) || HERMES_ALLOWED_HOSTS.has(parsed.hostname);
  // `new URL()` omite a porta default do protocolo (http→80): trata "" como 80.
  const effectivePort = parsed.port || "80";
  if (parsed.protocol !== "http:" || !hostOk || effectivePort !== String(p)) {
    return { ok: false, status: 400, error: `Destino de gateway não permitido: ${useHost}:${p}` };
  }
  return { ok: true, baseURL };
}
import { clearProgress, setProgress } from "./tool-progress.js";
import {
  backendForPort,
  consultToolToProfile,
  getLatestJob,
  isConsultTool,
  rememberJobBackend,
} from "./specialist-jobs.js";
import { recordJobAnchor } from "./specialist-job-anchors.js";

/**
 * Schemas das tools (sem function executor) — usado pelo Codex (Responses API).
 * O loop multi-turno chama os executors separadamente.
 */
function createCodexToolsAndExecutors(session: WavesSession): {
  tools: CodexTool[];
  executors: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  return {
    tools: toolsToResponsesFormat(createTools(session)),
    executors: {
      list_workflows: async () => await listWorkflows(session),
      get_workflow: async ({ workflow_id }) =>
        await getWorkflow(session, Number(workflow_id)),
      get_workflow_kanban: async ({ workflow_id }) =>
        await getWorkflowKanban(session, Number(workflow_id)),
      get_workflow_tasks: async ({ workflow_id, funnel_stage_id, status, overdue }) =>
        await getWorkflowTasks(session, Number(workflow_id), {
          funnel_stage_id: funnel_stage_id as number | undefined,
          status: status as string | undefined,
          overdue: overdue as boolean | undefined,
        }),
      get_workflow_statistics: async ({ workflow_id, metric, days }) =>
        await getWorkflowStatistics(
          session,
          Number(workflow_id),
          metric as WorkflowStatisticsMetric,
          (days as number | undefined) ?? 30,
        ),
      get_task: async ({ task_id }) =>
        await getTask(session, Number(task_id)),
      list_appointments: async ({ booking_id, start_date, end_date, status }) =>
        await listAppointments(session, Number(booking_id), {
          start_date: start_date as string | undefined,
          end_date: end_date as string | undefined,
          status: status as string | undefined,
        }),
      get_booking_available_dates: async ({ booking_id, start_date, end_date }) =>
        await getBookingAvailableDates(
          session,
          Number(booking_id),
          start_date as string | undefined,
          end_date as string | undefined,
        ),
      get_booking_available_slots: async ({ booking_id, date }) =>
        await getBookingAvailableSlots(session, Number(booking_id), String(date)),
      get_assistant_funnel: async ({ assistant_id }) =>
        await getAssistantFunnel(session, Number(assistant_id)),
    },
  };
}

function createTools(session: WavesSession) {
  return [
    {
      type: "function" as const,
      function: {
        name: "list_workflows",
        description:
          "Returns JSON with workflows visible to the user. Use data for Table, ListBlock, or workflow pickers in openui-lang.",
        parameters: { type: "object", properties: {}, required: [] },
        function: async () => JSON.stringify(await listWorkflows(session)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow",
        description:
          "Returns JSON metadata for one workflow. Use for CardHeader, TextContent, TagBlock in openui-lang.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
          },
          required: ["workflow_id"],
        },
        function: async ({ workflow_id }: { workflow_id: number }) =>
          JSON.stringify(await getWorkflow(session, workflow_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_kanban",
        description:
          "Returns JSON kanban board (stages/columns and tasks). Preferred for Tabs/TabItem kanban UI — map each stage to a tab and tasks to Table or nested Cards.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
          },
          required: ["workflow_id"],
        },
        function: async ({ workflow_id }: { workflow_id: number }) =>
          JSON.stringify(await getWorkflowKanban(session, workflow_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_tasks",
        description:
          "Returns JSON task list for a workflow. Use when kanban is unavailable; group by stage name for Tabs. Optional filters.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
            funnel_stage_id: { type: "number", description: "Filter by stage ID" },
            status: {
              type: "string",
              description: "e.g. in_progress, todo, done",
            },
            overdue: { type: "boolean", description: "Only overdue tasks" },
          },
          required: ["workflow_id"],
        },
        function: async ({
          workflow_id,
          funnel_stage_id,
          status,
          overdue,
        }: {
          workflow_id: number;
          funnel_stage_id?: number;
          status?: string;
          overdue?: boolean;
        }) =>
          JSON.stringify(
            await getWorkflowTasks(session, workflow_id, {
              funnel_stage_id,
              status,
              overdue,
            }),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_workflow_statistics",
        description:
          "Returns JSON statistics for dashboards: overview (KPIs), by-stage (PieChart/BarChart), by-user, by-task-type, timeline.",
        parameters: {
          type: "object",
          properties: {
            workflow_id: { type: "number", description: "Workflow ID" },
            metric: {
              type: "string",
              enum: ["overview", "by-stage", "by-user", "by-task-type", "timeline"],
              description: "Which statistics endpoint to call",
            },
            days: {
              type: "number",
              description: "For timeline only (default 30)",
            },
          },
          required: ["workflow_id", "metric"],
        },
        function: async ({
          workflow_id,
          metric,
          days,
        }: {
          workflow_id: number;
          metric: WorkflowStatisticsMetric;
          days?: number;
        }) =>
          JSON.stringify(
            await getWorkflowStatistics(session, workflow_id, metric, days ?? 30),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_task",
        description:
          "Returns JSON for one task (title, stage, checklist, assignee). Use for detail Card + ListBlock checklist.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "number", description: "Task ID" },
          },
          required: ["task_id"],
        },
        function: async ({ task_id }: { task_id: number }) =>
          JSON.stringify(await getTask(session, task_id)),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "list_appointments",
        description:
          "Lista agendamentos (appointments) marcados numa agenda específica em um período. Cada appointment tem 'json' com os dados do formulário (nome paciente, telefone). Use pra responder 'agendamentos da próxima semana', 'quem agendou para amanhã', 'consultas marcadas em X'.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda (booking)" },
            start_date: { type: "string", description: "Data inicial ISO YYYY-MM-DD (opcional)" },
            end_date: { type: "string", description: "Data final ISO YYYY-MM-DD (opcional)" },
            status: { type: "string", description: "Filtro de status (pending, confirmed, cancelled — opcional)" },
          },
          required: ["booking_id"],
        },
        function: async ({
          booking_id,
          start_date,
          end_date,
          status,
        }: {
          booking_id: number;
          start_date?: string;
          end_date?: string;
          status?: string;
        }) =>
          JSON.stringify(
            await listAppointments(session, booking_id, {
              start_date,
              end_date,
              status,
            }),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_booking_available_dates",
        description:
          "Datas que ainda têm slots disponíveis numa agenda dentro de um período. Use pra 'quando posso marcar', 'datas disponíveis em junho', 'dias livres'.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda" },
            start_date: { type: "string", description: "Data inicial YYYY-MM-DD (opcional)" },
            end_date: { type: "string", description: "Data final YYYY-MM-DD (opcional)" },
          },
          required: ["booking_id"],
        },
        function: async ({
          booking_id,
          start_date,
          end_date,
        }: {
          booking_id: number;
          start_date?: string;
          end_date?: string;
        }) =>
          JSON.stringify(
            await getBookingAvailableDates(session, booking_id, start_date, end_date),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_booking_available_slots",
        description:
          "Horários (slots) disponíveis numa agenda em UM dia específico. Use pra 'que horários tem em 2026-06-04', 'slots de hoje', etc.",
        parameters: {
          type: "object",
          properties: {
            booking_id: { type: "number", description: "ID da agenda" },
            date: { type: "string", description: "Data alvo YYYY-MM-DD" },
          },
          required: ["booking_id", "date"],
        },
        function: async ({
          booking_id,
          date,
        }: {
          booking_id: number;
          date: string;
        }) =>
          JSON.stringify(
            await getBookingAvailableSlots(session, booking_id, date),
          ),
        parse: JSON.parse,
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_assistant_funnel",
        description:
          "Retorna o funil (funnel) de captação associado a um assistant, com suas stages (id, nome, cor, ordem, parent, has_form). Use quando o user pedir detalhes de um funil, stages de um assistant, ou para renderizar pipeline visual. O contexto da sessão já lista os funis disponíveis com IDs.",
        parameters: {
          type: "object",
          properties: {
            assistant_id: {
              type: "number",
              description: "ID do assistant dono do funil",
            },
          },
          required: ["assistant_id"],
        },
        function: async ({ assistant_id }: { assistant_id: number }) =>
          JSON.stringify(await getAssistantFunnel(session, assistant_id)),
        parse: JSON.parse,
      },
    },
  ];
}

function sseToolCallStart(
  encoder: TextEncoder,
  tc: { id: string; function: { name: string } },
  index: number,
) {
  return encoder.encode(
    `data: ${JSON.stringify({
      id: `chatcmpl-tc-${tc.id}`,
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: tc.id,
                type: "function",
                function: { name: tc.function.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  );
}

function sseToolCallArgs(
  encoder: TextEncoder,
  tc: { id: string; function: { arguments: string } },
  result: string,
  index: number,
): Uint8Array {
  let enrichedArgs: string;
  try {
    enrichedArgs = JSON.stringify({
      _request: JSON.parse(tc.function.arguments),
      _response: JSON.parse(result),
    });
  } catch {
    enrichedArgs = tc.function.arguments;
  }
  // Chunkar em pedaços de 4KB — adapter SSE do frontend não buffera linhas
  // partidas entre HTTP reads. Mesmo bug do branch Codex (vide comentário lá).
  const CHUNK_SIZE = 4096;
  const parts: string[] = [];
  for (let off = 0; off < enrichedArgs.length; off += CHUNK_SIZE) {
    const piece = enrichedArgs.slice(off, off + CHUNK_SIZE);
    parts.push(
      `data: ${JSON.stringify({
        id: `chatcmpl-tc-${tc.id}-args-${off}`,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index, id: tc.id, function: { arguments: piece } }],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  return encoder.encode(parts.join(""));
}

// Tipos do escopo enviado pelo frontend pós-login. Lista TUDO que o user vê
// na plataforma — fica embutido no system prompt pra agente ter awareness
// sem precisar chamar tools pra perguntas básicas de inventário.
interface UserInfo {
  id?: number | string;
  name?: string;
  email?: string;
  type?: string;
}

interface ScopeWorkflow {
  id: number;
  name?: string | null;
  title?: string | null;
  description?: string | null;
}

interface ScopeAssistant {
  id: number;
  name?: string | null;
  title?: string | null;
}

interface ScopeBooking {
  id: number;
  name?: string | null;
  title?: string | null;
  booking_name?: string | null;
}

interface ScopeFunnelStage {
  id: number;
  name?: string | null;
  color?: string | null;
  order?: number | null;
  parent_id?: number | null;
  hidden?: boolean;
  has_form?: boolean;
}

interface ScopeFunnel {
  id: number;
  name?: string | null;
  description?: string | null;
  assistant_id: number;
  workflow_id?: number | null;
  stages_count?: number;
  stages?: ScopeFunnelStage[];
}

interface UserScopePayload {
  workflows: ScopeWorkflow[];
  assistants: ScopeAssistant[];
  bookings: ScopeBooking[];
  funnels?: ScopeFunnel[];
  defaultWorkflowId?: number | null;
  defaultAssistantId?: number | null;
  defaultBookingId?: number | null;
  fetchedAt?: number;
}

interface ChatRequestBody {
  messages: unknown[];
  /**
   * ID do profile Hermes ativo (ex.: `ybrax-negative-media`, `ybrax-map`).
   * Default = `ybrax-negative-media`. Define qual gateway recebe a request.
   */
  profile?: string;
  /** Host do gateway do agente (vindo do LOGIN). Só é usado se estiver na
   *  allowlist HERMES_ALLOWED_HOSTS; caso contrário cai em 127.0.0.1 (gateways
   *  co-locados fazem bind em loopback). */
  host?: string;
  /** Porta do gateway do agente (vinda do LOGIN). Determina qual gateway recebe. */
  port?: number;
  /**
   * UUID curto da thread/conversa atual. Quando presente, vira sufixo do
   * sessionId enviado pro Hermes (`waves-user-1::<threadId>`), permitindo
   * múltiplas conversas paralelas por user. Ausente = mantém comportamento
   * legacy (`waves-user-1` ou `waves-anon` flat).
   */
  threadId?: string;
  /** Esforço de reasoning do modelo p/ esta conversa: "none" (rápido) ou
   *  "medium" (aprofundado). Vira o header X-Hermes-Reasoning-Effort. Ausente =
   *  usa o reasoning_effort do config.yaml do profile. */
  reasoningEffort?: string;
  wavesSession?: WavesSession;
  defaultWorkflowId?: number;
  persona?: string | null;
  permissions?: string[];
  user?: UserInfo;
  roles?: string[];
  userScope?: UserScopePayload | null;
  attachments?: AttachmentPayload[];
  /** Pede o bloco de usage (tokens) no stream. Só quando admin (badge admin-only). */
  wantUsage?: boolean;
}

/**
 * Arquivo enviado pelo composer (já salvo + extraído pelo `/api/uploads`).
 * O texto extraído é injetado na última mensagem do user antes de ir pro LLM.
 */
interface AttachmentPayload {
  filename: string;
  mimeType: string;
  kind: "pdf" | "doc" | "sheet" | "text" | "image" | "other";
  size: number;
  url: string;
  path: string;
  text?: string;
  truncated?: boolean;
  error?: string;
}

function formatBytesServer(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMG_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Lê o arquivo de imagem do disco e devolve um data-URI base64
 * (`data:image/png;base64,…`) — o formato que o api_server do Hermes aceita
 * em partes `image_url` (validado em `_normalize_multimodal_content`).
 * `null` se não conseguir ler ou se o mime não for de imagem suportada.
 */
function imageToDataUri(a: AttachmentPayload): string | null {
  let mime = a.mimeType?.toLowerCase();
  if (!mime || !mime.startsWith("image/")) {
    mime = IMG_EXT_TO_MIME[extname(a.filename).toLowerCase()];
  }
  if (!mime) return null;
  try {
    const b64 = readFileSync(a.path).toString("base64");
    if (!b64) return null;
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Injeta os anexos na ÚLTIMA mensagem `user` (mutação in-place):
 *   - texto extraído (PDF/DOCX/XLSX/texto) vira um bloco `<arquivos_anexados>`;
 *   - IMAGENS viram partes `image_url` (data-URI base64) — o api_server do
 *     Hermes preserva e o modelo (que já tem visão, ver canal Telegram) enxerga.
 *
 * Quando há imagem, o conteúdo da mensagem passa a ser um array multimodal
 * `[{type:"text"}, {type:"image_url"}, …]` no formato OpenAI Chat Completions.
 */
// #824 — base pública do waves_client pra montar URL ABSOLUTA do anexo (retrieval
// cross-host: o lab-worker em OUTRO host fetcha a URL assinada). Se vazio, cai na
// URL relativa (o consumidor prefixa com o host do waves_client do mesmo tenant).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
function fileRef(a: AttachmentPayload): string {
  return `${PUBLIC_BASE_URL}${a.url}`;
}

function injectAttachments(
  messages: unknown[],
  attachments: AttachmentPayload[],
): void {
  if (!attachments?.length) return;

  // 1. Parte textual (texto extraído + notas dos anexos).
  const blocks: string[] = [
    "<arquivos_anexados>",
    "O usuário anexou os arquivos abaixo. Use o conteúdo (texto extraído e/ou imagens) como contexto. Não invente dados que não estejam aqui.",
    "",
  ];
  // 2. Partes de imagem (image_url) acumuladas.
  const imageParts: Array<{ type: "image_url"; image_url: { url: string } }> = [];

  for (const a of attachments) {
    const head = `### ${a.filename} (${a.mimeType} · ${formatBytesServer(a.size)})`;
    if (a.text && a.text.trim()) {
      blocks.push(head);
      blocks.push(a.truncated ? "Conteúdo extraído (truncado):" : "Conteúdo extraído:");
      blocks.push('"""', a.text.trim(), '"""', "");
    } else if (a.kind === "image") {
      const dataUri = imageToDataUri(a);
      if (dataUri) {
        imageParts.push({ type: "image_url", image_url: { url: dataUri } });
        blocks.push(`${head} — imagem anexada (conteúdo visual incluído abaixo).`);
      } else {
        blocks.push(`${head} — imagem; não foi possível anexar o conteúdo visual. Recuperável (URL assinada, escopo do dono): ${fileRef(a)}`);
      }
      blocks.push("");
    } else if (a.error) {
      blocks.push(`${head} — não foi possível extrair texto (${a.error}). Arquivo recuperável (qualquer host, URL assinada, escopo do dono): ${fileRef(a)}`);
      blocks.push("");
    } else {
      // #824 — sem conteúdo legível (vídeo/áudio/binário): NÃO injeta o caminho
      // LOCAL (inútil cross-host). Injeta a URL ASSINADA — fetchável por HTTP de
      // qualquer host (lab-worker em outro servidor) e escopada por owner via sig.
      blocks.push(`${head} — sem texto extraível. Arquivo recuperável (qualquer host, URL assinada, escopo do dono): ${fileRef(a)}`);
      blocks.push("");
    }
  }
  blocks.push("</arquivos_anexados>");
  const block = blocks.join("\n");

  // Diagnóstico: confirma o que de fato foi anexado na mensagem.
  console.log(
    `[chat:attach] anexos=${attachments.length} ` +
      `imagens_embutidas=${imageParts.length} ` +
      `tipos=[${attachments.map((a) => `${a.kind}${a.text ? "+txt" : ""}`).join(", ")}]`,
  );

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "user") continue;
    const c = m.content;

    // Extrai só o TEXTO do conteúdo existente — descarta partes de imagem
    // mandadas pelo cliente (o composer envia `binary`/`image_url` com URL
    // relativa /api/uploads, que serve só pra renderização e quebraria a
    // validação do api_server). O servidor reconstrói as imagens em base64.
    let baseText = "";
    if (typeof c === "string") {
      baseText = c;
    } else if (Array.isArray(c)) {
      baseText = (c as Array<Record<string, unknown>>)
        .filter((p) => p && p.type === "text")
        .map((p) => String((p as { text?: unknown }).text ?? ""))
        .join("");
    }

    const textCombined = baseText ? `${baseText}\n\n${block}` : block;
    m.content =
      imageParts.length > 0
        ? [{ type: "text", text: textCombined }, ...imageParts]
        : textCombined;
    return;
  }
}

/**
 * Monta bloco de texto com o escopo do user pra injetar no system prompt.
 * Agente lê isso e responde perguntas básicas sem precisar chamar list_workflows
 * etc. Ainda pode chamar tools pra detalhes (kanban, statistics, task individual).
 */
function buildScopeContext(body: ChatRequestBody): string {
  const lines: string[] = [];
  const scope = body.userScope ?? null;
  const u = body.user;

  // Data atual em ISO + dia da semana — agente precisa pra resolver "próxima
  // semana", "amanhã", etc, ao calcular ranges pra list_appointments.
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("pt-BR", { weekday: "long" });

  lines.push("");
  lines.push("---");
  lines.push("## Contexto do usuário (carregado no login)");
  lines.push("");
  lines.push(`**Data atual:** ${todayIso} (${weekday})`);
  lines.push("");

  if (u) {
    const userBits = [
      u.name && `**${u.name}**`,
      u.email && `\`${u.email}\``,
      u.id != null && `id=${u.id}`,
      u.type && `type=${u.type}`,
    ].filter(Boolean);
    if (userBits.length) lines.push(`**Usuário:** ${userBits.join(" · ")}`);
  }

  if (body.roles && body.roles.length) {
    lines.push(`**Roles:** ${body.roles.join(", ")}`);
  }
  if (body.persona) {
    lines.push(`**Persona inferida:** ${body.persona}`);
  }

  if (body.permissions && body.permissions.length) {
    const perms = body.permissions;
    const preview = perms.slice(0, 15).join(", ");
    const more = perms.length > 15 ? ` (+${perms.length - 15} outras)` : "";
    lines.push(`**Permissões (${perms.length}):** ${preview}${more}`);
  }

  if (scope) {
    // Workflows
    if (scope.workflows && scope.workflows.length) {
      lines.push("");
      lines.push(`**Workflows visíveis (${scope.workflows.length}):**`);
      const max = 15;
      for (const w of scope.workflows.slice(0, max)) {
        const label = w.name ?? w.title ?? `(sem nome)`;
        lines.push(`- \`${w.id}\` — ${label}`);
      }
      if (scope.workflows.length > max) {
        lines.push(`- … (+${scope.workflows.length - max} workflows não listados)`);
      }
      if (scope.defaultWorkflowId != null) {
        lines.push(`(workflow padrão: \`${scope.defaultWorkflowId}\`)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Workflows:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — use `list_workflows` (ou Query no " +
          "runtime) pra listar quando precisar.",
      );
    }

    // Assistants
    if (scope.assistants && scope.assistants.length) {
      lines.push("");
      lines.push(`**Assistentes visíveis (${scope.assistants.length}):**`);
      const max = 12;
      for (const a of scope.assistants.slice(0, max)) {
        const label = a.name ?? a.title ?? `(sem nome)`;
        lines.push(`- \`${a.id}\` — ${label}`);
      }
      if (scope.assistants.length > max) {
        lines.push(`- … (+${scope.assistants.length - max} assistentes não listados)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Assistentes:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — use `list_assistants` pra listar " +
          "quando precisar.",
      );
    }

    // Bookings
    if (scope.bookings && scope.bookings.length) {
      lines.push("");
      lines.push(`**Agendas visíveis (${scope.bookings.length}):**`);
      const max = 12;
      for (const b of scope.bookings.slice(0, max)) {
        const label = b.booking_name ?? b.name ?? b.title ?? `(sem nome)`;
        lines.push(`- \`${b.id}\` — ${label}`);
      }
      if (scope.bookings.length > max) {
        lines.push(`- … (+${scope.bookings.length - max} agendas não listadas)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Agendas:** inventário NÃO pré-carregado no login (otimização). " +
          "NÃO afirme que o usuário tem 0 — busque sob demanda quando precisar.",
      );
    }

    // Funnels (1 por assistant; lista nome + stages slim no contexto)
    if (scope.funnels && scope.funnels.length) {
      lines.push("");
      lines.push(`**Funis visíveis (${scope.funnels.length}):**`);
      const max = 8;
      for (const f of scope.funnels.slice(0, max)) {
        const stageBits = (f.stages ?? [])
          .filter((s) => !s.hidden)
          .map((s) => s.name)
          .filter(Boolean)
          .slice(0, 8)
          .join(" → ");
        const more =
          f.stages_count != null && f.stages_count > 8
            ? ` (+${f.stages_count - 8})`
            : "";
        const label = f.name ?? `Funil ${f.id}`;
        lines.push(
          `- \`${f.id}\` — ${label} · assistant=\`${f.assistant_id}\` · ${f.stages_count ?? f.stages?.length ?? 0} stages` +
            (stageBits ? `: ${stageBits}${more}` : ""),
        );
      }
      if (scope.funnels.length > max) {
        lines.push(`- … (+${scope.funnels.length - max} funis não listados)`);
      }
    } else {
      lines.push("");
      lines.push(
        "**Funis/estágios:** NÃO pré-carregados no login. NÃO afirme que o " +
          "usuário tem 0 — o estágio de cada AP vem de `get_workflow_kanban` / " +
          "`list_tasks` (ou Query no runtime), não do scope.",
      );
    }
  }

  lines.push("");
  lines.push(
    "**Como usar:** pra perguntas básicas (quantos/quais workflows/assistentes/agendas/funis), responda direto desse contexto. " +
      "Use tools (`get_workflow_kanban`, `get_workflow_tasks`, `get_workflow_statistics`, `get_task`, `get_assistant_funnel`) só pra detalhes que não estão acima.",
  );
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

export async function handleChatRequest(body: ChatRequestBody): Promise<Response> {
  const { messages, wavesSession, defaultWorkflowId } = body;

  // Injeta o texto extraído dos anexos na última mensagem do user (antes de
  // detectar demo/cache triggers e de despachar pro provider).
  if (body.attachments?.length) {
    injectAttachments(messages, body.attachments);
  }

  const scopeContext = buildScopeContext(body);

  // Atalho: mensagem demo (__demo_cnpj__, __demo_cpf__, __demo_ibracem__)
  // retorna openui-lang hardcoded direto, sem ir pro LLM. Útil pra renderizar
  // o template canônico de relatório IBRACEM em <1s — comparar visual sem
  // depender da pipeline de busca real (que hoje sofre CAPTCHA do Bing/DDG).
  const lastUserMessage = findLastUserMessage(messages);
  if (lastUserMessage) {
    const demo = getDemoReport(lastUserMessage);
    if (demo) {
      return streamHardcodedOpenUI(demo);
    }
  }

  // Cache de form trigger: pra `__form_cnpj__` / `__form_cpf__` o Hermes sempre
  // emite o mesmo bloco openui-lang (response determinística governada pelo
  // SOUL). Em vez de pagar 3-4s por chamada, cacheamos a resposta da primeira
  // execução em memória e servimos as próximas em <50ms. Cache invalida quando
  // o SOUL.md muda (por mtime).
  if (lastUserMessage && isCacheableTrigger(lastUserMessage)) {
    const hit = getFormCached(lastUserMessage);
    if (hit) {
      return streamHardcodedOpenUI(hit);
    }
    // Cache miss — segue fluxo normal pro Hermes; depois capturamos a resposta
    // pra popular o cache. Marker booleano lido no final do stream do Hermes.
    (body as ChatRequestBody & { __cacheTrigger?: string }).__cacheTrigger =
      lastUserMessage.trim().toLowerCase();
  }

  if (!wavesSession?.accessToken || !wavesSession.environment) {
    return new Response(JSON.stringify({ error: "Sessão Waves ausente." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provider = getOpenAiProvider();
  // Hermes (apps desacopladas) autentica com o Bearer do PRÓPRIO usuário (não a
  // service key do gateway) — o branch hermes passa `apiKey: userToken`. Então NÃO
  // resolvemos getOpenAiCredential() aqui (evita exigir HERMES_API_KEY/.key à toa).
  // Só codex/openai usam a credencial resolvida.
  let apiKey = "";
  if (provider !== "hermes") {
    try {
      apiKey = getOpenAiCredential();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: msg, provider }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const baseURL = getOpenAiBaseUrl();
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  // Codex backend (chatgpt.com) usa Responses API + headers CF + schema diferente.
  // Branch dedicado — codex-client.ts encapsula a complexidade.
  if (provider === "codex") {
    return handleChatRequestCodex({
      apiKey,
      baseURL: baseURL ?? "https://chatgpt.com/backend-api/codex",
      model,
      messages,
      wavesSession,
      defaultWorkflowId,
      scopeContext,
    });
  }

  // Hermes backend — apps desacopladas: o alvo (porta) vem do LOGIN (não há
  // lista de profiles no servidor). A auth é o token Waves do PRÓPRIO usuário
  // (não a api_key do gateway). Ver resolveHermesGateway().
  if (provider === "hermes") {
    const cacheTrigger = (body as ChatRequestBody & { __cacheTrigger?: string })
      .__cacheTrigger;
    const gw = resolveHermesGateway(body.host, body.port);
    if (!gw.ok) {
      return new Response(
        JSON.stringify({ error: gw.error }),
        { status: gw.status, headers: { "Content-Type": "application/json" } },
      );
    }
    const userToken = wavesSession?.accessToken;
    if (!userToken) {
      return new Response(
        JSON.stringify({ error: "Sessão sem token de usuário" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return handleChatRequestHermes({
      apiKey: userToken,
      baseURL: gw.baseURL,
      messages,
      threadId: body.threadId,
      reasoningEffort: body.reasoningEffort,
      scopeContext,
      user: body.user,
      wavesSession,
      userScope: body.userScope ?? null,
      cacheTrigger,
      wantUsage: body.wantUsage === true,
      profileId: body.profile,
      agentId: body.agentId,
    });
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  const tools = createTools(wavesSession);

  const defaultWfHint =
    defaultWorkflowId != null
      ? `\n\nWorkflow padrão do usuário: ID ${defaultWorkflowId}. Use quando o pedido não especificar outro.`
      : "";
  const contextHint = scopeContext + defaultWfHint;

  const cleanMessages = (messages as Array<Record<string, unknown>>)
    .filter((m) => m.role !== "tool")
    .map((m) => {
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const { tool_calls: _tc, ...rest } = m;
        return rest;
      }
      return m;
    });

  const systemPrompt = buildWavesSystemPrompt();

  const chatMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + contextHint },
    ...(cleanMessages as ChatCompletionMessageParam[]),
  ];

  const encoder = new TextEncoder();
  let controllerClosed = false;

  const readable = new ReadableStream({
    start(controller) {
      const enqueue = (data: Uint8Array) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(data);
        } catch {
          /* already closed */
        }
      };

      // Heartbeat SSE — ver justificativa no caminho hermes (mantém Safari mobile vivo).
      const heartbeat = setInterval(() => {
        if (controllerClosed) return;
        enqueue(encoder.encode(": keepalive\n\n"));
      }, 1_000);

      const close = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const pendingCalls: Array<{ id: string; name: string; arguments: string }> = [];
      let callIdx = 0;
      let resultIdx = 0;
      let assistantContent = "";

      const runner = (client.chat.completions as unknown as {
        runTools: (opts: unknown) => {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
        };
      }).runTools({
        model,
        messages: chatMessages,
        tools,
        stream: true,
        max_completion_tokens: 8192,
      });

      runner.on("functionToolCall", (fc: unknown) => {
        const call = fc as { name: string; arguments: string };
        const id = `tc-${callIdx}`;
        pendingCalls.push({ id, name: call.name, arguments: call.arguments });
        enqueue(
          sseToolCallStart(encoder, { id, function: { name: call.name } }, callIdx),
        );
        callIdx++;
      });

      runner.on("functionToolCallResult", (result: unknown) => {
        const tc = pendingCalls[resultIdx];
        if (tc) {
          enqueue(
            sseToolCallArgs(
              encoder,
              { id: tc.id, function: { arguments: tc.arguments } },
              String(result),
              resultIdx,
            ),
          );
        }
        resultIdx++;
      });

      runner.on("chunk", (chunk: unknown) => {
        const c = chunk as {
          id?: string;
          object?: string;
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>;
        };
        const choice = c.choices?.[0];
        const delta = choice?.delta;
        if (!delta) return;
        if (delta.content) {
          assistantContent += delta.content;
        }
        if (delta.content || choice?.finish_reason === "stop") {
          enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      });

      runner.on("end", () => {
        const workflowId =
          extractWorkflowIdFromToolCalls(pendingCalls) ?? defaultWorkflowId;
        const { content: patched, appended } = ensureFollowUps(assistantContent, {
          workflowId,
        });

        if (appended && patched.length > assistantContent.length) {
          const suffix = patched.slice(assistantContent.length);
          enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: "chatcmpl-followups",
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: { content: suffix },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            ),
          );
        }

        enqueue(encoder.encode("data: [DONE]\n\n"));
        close();
      });

      runner.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Stream error";
        console.error("Chat route error:", msg);
        enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        close();
      });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ============================================================================
// Branch CODEX (Responses API + CF headers + multi-turno manual)
// ============================================================================

interface HandleCodexOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: unknown[];
  wavesSession: WavesSession;
  defaultWorkflowId?: number;
  scopeContext?: string;
}

async function handleChatRequestCodex(opts: HandleCodexOptions): Promise<Response> {
  const {
    apiKey,
    baseURL,
    model,
    messages,
    wavesSession,
    defaultWorkflowId,
    scopeContext = "",
  } = opts;

  const client = buildCodexClient(apiKey, baseURL);
  const { tools, executors } = createCodexToolsAndExecutors(wavesSession);

  const defaultWfHint =
    defaultWorkflowId != null
      ? `\n\nWorkflow padrão do usuário: ID ${defaultWorkflowId}. Use quando o pedido não especificar outro.`
      : "";
  const contextHint = scopeContext + defaultWfHint;

  // Limpa mensagens (mesmo tratamento do branch clássico)
  const cleanMessages = (messages as Array<Record<string, unknown>>)
    .filter((m) => m.role !== "tool")
    .map((m) => {
      if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const { tool_calls: _tc, ...rest } = m;
        return rest;
      }
      return m;
    });

  const systemPrompt = buildWavesSystemPrompt();

  const encoder = new TextEncoder();
  let controllerClosed = false;

  const readable = new ReadableStream({
    start(controller) {
      const enqueue = (data: Uint8Array) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(data);
        } catch {
          /* closed */
        }
      };
      // Heartbeat SSE — ver justificativa no caminho hermes (Safari mobile).
      const heartbeat = setInterval(() => {
        if (controllerClosed) return;
        enqueue(encoder.encode(": keepalive\n\n"));
      }, 1_000);
      const close = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };

      let assistantContent = "";
      const pendingCallsForFollowups: Array<{ name: string; arguments: string }> = [];

      runCodexChat({
        client,
        model,
        systemPrompt: systemPrompt + contextHint,
        // O tipo ChatMessage local do codex-client é compatível com o cleanMessages aqui.
        messages: cleanMessages as Parameters<typeof runCodexChat>[0]["messages"],
        tools,
        executors,
        onContentDelta: (text) => {
          assistantContent += text;
          // Emite no formato chat.completions clássico (frontend já parseia)
          enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: "chatcmpl-codex",
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: { content: text },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            ),
          );
        },
        onToolCallStart: ({ id, name, index }) => {
          enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: `chatcmpl-tc-${id}`,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index,
                          id,
                          type: "function",
                          function: { name, arguments: "" },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            ),
          );
        },
        onToolCallResult: ({ id, name, args, result, index }) => {
          pendingCallsForFollowups.push({ name, arguments: args });
          let enriched: string;
          try {
            enriched = JSON.stringify({
              _request: args ? JSON.parse(args) : {},
              _response: JSON.parse(result),
            });
          } catch {
            enriched = args;
          }
          // O adapter SSE do @openuidev/react-headless divide chunks por \n
          // sem buffer entre reads — se um único `data: {...}` for maior que
          // ~8-16KB, HTTP fragmenta e o JSON.parse no browser quebra
          // ("Unterminated string"). Fix: emite o `enriched` em pedaços de
          // 4KB via múltiplos SSE com mesmo toolCallId — o adapter já
          // concatena (TOOL_CALL_ARGS é additive).
          const CHUNK_SIZE = 4096;
          for (let offset = 0; offset < enriched.length; offset += CHUNK_SIZE) {
            const piece = enriched.slice(offset, offset + CHUNK_SIZE);
            enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: `chatcmpl-tc-${id}-args-${offset}`,
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          { index, id, function: { arguments: piece } },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`,
              ),
            );
          }
        },
        onEnd: (finalContent) => {
          const workflowId =
            extractWorkflowIdFromToolCalls(pendingCallsForFollowups) ??
            defaultWorkflowId;
          const { content: patched, appended } = ensureFollowUps(finalContent, {
            workflowId,
          });
          if (appended && patched.length > finalContent.length) {
            const suffix = patched.slice(finalContent.length);
            enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chatcmpl-followups",
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: { content: suffix },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`,
              ),
            );
          }
          enqueue(encoder.encode("data: [DONE]\n\n"));
          close();
        },
        onError: (err) => {
          console.error("Codex route error:", err.message);
          enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`),
          );
          enqueue(encoder.encode("data: [DONE]\n\n"));
          close();
        },
      });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ============================================================================
// Branch HERMES (Steve via api_server local, port 18860)
// ============================================================================
//
// O Steve já tem SOUL/identity + MCP bioshield + skills. Aqui injetamos
// as 26 tools NATIVAS da Waves (geradas de /api/openui/spec) como funções
// OpenAI no request. Quando o Steve precisar de dados da Waves
// (workflows/tasks/funnels/boards), ele chama uma dessas tools — o Express
// executa via /api/openui/tools/<name> e devolve.
//
// Spec é a ÚNICA fonte da verdade: tools custom hardcoded da Waves
// deprecadas (continuam só nos branches codex/openai como fallback).

interface HandleHermesOptions {
  apiKey: string;
  baseURL: string; // ex.: http://127.0.0.1:18860/v1
  messages: unknown[];
  scopeContext?: string;
  user?: UserInfo;
  wavesSession: WavesSession;
  userScope?: UserScopePayload | null;
  /** Pede usage de tokens no stream (só admin). */
  wantUsage?: boolean;
  /**
   * Trigger reconhecido pelo `form-cache` (`__form_cnpj__` / `__form_cpf__`).
   * Quando presente, ao final do stream a resposta agregada é gravada em cache
   * pra que próximas chamadas com a mesma mensagem sirvam em <50ms.
   */
  cacheTrigger?: string;
  /**
   * UUID da thread/conversa atual no waves_client. Sufixa o sessionId enviado
   * pro Hermes — habilita múltiplas conversas paralelas por user.
   */
  threadId?: string;
  /** Override de reasoning_effort → header X-Hermes-Reasoning-Effort. */
  reasoningEffort?: string;
  /**
   * ID do profile Hermes resolvido (gw.id). Usado pelo hard path pra gravar o
   * token do usuário na pasta do PRÓPRIO profile (não vaza token entre profiles).
   */
  profileId?: string;
  /** agent_id (do login) → header X-Hermes-Agent-Id pro gateway gravar na web-session. */
  agentId?: number | string;
}

/**
 * Economia de tokens: as respostas `assistant` antigas são openui-lang longo
 * (um kanban = vários k tokens). O modelo raramente precisa da UI antiga
 * renderizada — só do que ela significou. Mantém as últimas `keepLast` cheias
 * e troca as anteriores por um marcador curto (com dica do título).
 */
const OPENUI_HINT_RE =
  /\b(root\s*=|Card\s*\(|CardHeader\s*\(|Kanban\s*\(|Table\s*\(|TagBlock\s*\(|BarChart\s*\(|PieChart\s*\(|ListBlock\s*\(|Steps\s*\(|FollowUpBlock\s*\()/;

function truncateOldAssistantUI(
  msgs: Array<Record<string, unknown>>,
  keepLast = 1,
): Array<Record<string, unknown>> {
  const assistantIdx = msgs
    .map((m, i) => (m.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(assistantIdx.slice(-keepLast));
  return msgs.map((m, i) => {
    if (m.role !== "assistant" || keep.has(i)) return m;
    const c = m.content;
    if (typeof c === "string" && c.length > 200 && OPENUI_HINT_RE.test(c)) {
      const title = c.match(/CardHeader\(\s*["']([^"']{0,60})/)?.[1];
      return { ...m, content: `[UI renderizada anteriormente${title ? `: ${title}` : ""}]` };
    }
    return m;
  });
}

async function handleChatRequestHermes(
  opts: HandleHermesOptions,
): Promise<Response> {
  const { apiKey, baseURL, messages, scopeContext = "", user, wavesSession, userScope, cacheTrigger, threadId, reasoningEffort, profileId, agentId, wantUsage } = opts;

  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;
  console.log(`[chat:timing] ${elapsed()} - handler start (user=${user?.id ?? "anon"}, thread=${threadId ?? "—"})`);

  // Token do usuário → MCP: NÃO gravamos mais o web-sessions daqui. O GATEWAY
  // Hermes persiste o Bearer (que ele já recebe no Authorization) em
  // state/web-sessions/<id>.json no _check_auth — apps desacopladas, o client
  // não toca o FS do Hermes. (ver hermes-patches: _persist_web_session.)

  // 1. (REMOVIDO 2026-05-26) Antes carregava spec OpenUI da Waves a cada
  //    request pra montar `toolsHint` no system_prompt. Mas:
  //    (a) Hermes Gateway IGNORA o campo `tools` do body OpenAI (arquitetura
  //        MCP-style — usa próprios toolsets + plugins), então o array de
  //        tools NUNCA chegava ao agente.
  //    (b) O fetch síncrono à Waves (sem timeout, sem cache-on-failure)
  //        adicionava 0.5-60s ao TTFB de cada `/api/chat`. Quando a Waves
  //        retornava 429 ou ficava lenta, todos os chats travavam.
  //    O `toolsHint` (texto que listava tools nativas) sobrava apenas como
  //    dica no prompt — agora o Steve recebe a referência completa via
  //    /home/bot/.hermes/shared-knowledge/waves/api-reference/BABBLE_API.md
  //    (citado no SOUL §3), que é fonte estável e versionada.
  const tools: ReturnType<typeof buildOpenAIToolsFromSpec> = [];
  const toolsSchemaForAPI: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }> = [];
  const toolsHint = "";

  // 2. Limpa mensagens
  const cleanMessages = truncateOldAssistantUI(
    (messages as Array<Record<string, unknown>>)
      .filter((m) => m.role !== "tool")
      .map((m) => {
        if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
          const { tool_calls: _tc, ...rest } = m;
          return rest;
        }
        return m;
      }),
  );

  // 3. Examples dinâmicos: kanban/funnel renderizados com DADOS REAIS do user.
  //    Steve vê estrutura com ids/nomes próprios → copia padrão natural em vez
  //    de gerar com dados fake. Cache 5min por user_id.
  // (REMOVIDO 2026-05-26) buildDynamicExamples fazia 2 fetches serializados à
  // Waves (kanban + funnel) a cada request sem cache de falha — somava ao
  // TTFB. Os exemplos eram úteis pro agente ver estrutura de dados reais, mas
  // não vitais: Steve consulta a Waves ao vivo quando precisa.
  const dynamicExamples = "";

  // 4. System prompt: library prompt (single-source) + scopeContext (user inventory)
  //    + toolsHint (26 tools da Waves) + dynamicExamples (kanban/funnel real).
  const systemPrompt =
    buildWavesPromptForHermes() + scopeContext + toolsHint + dynamicExamples;

  // 4. Session-id por user + thread.
  //
  // Cada conversa nova no waves_client tem um threadId próprio (UUID gerado
  // no frontend). Aqui montamos `<userPrefix>::<threadId>` — assim o Hermes
  // mantém sessions distintas pra cada conversa, e o histórico fica acessível
  // por thread (via `/api/threads/:id/messages`).
  //
  // (HARDENING 2026-05-26) threadId "ephemeral" / vazio / "default" cai num
  // bucket compartilhado entre todas as conversas — vimos isso explodir pra
  // 116 mensagens/142k tokens, disparando Preflight compression em toda
  // request e adicionando 9-120s de latência. Detectamos esses casos e
  // geramos um UUID por-request pra forçar isolamento.
  // Vincula a sessão ao TENANT (resolvido por host via ALS) — assim o mesmo
  // user-id em tenants diferentes não compartilha sessão/histórico no gateway.
  const tenantId = getActiveTenant().id;
  const userPrefix =
    user?.id != null ? `waves-${tenantId}-user-${user.id}` : `waves-${tenantId}-anon`;
  const SHARED_BUCKETS = new Set(["", "ephemeral", "default", "shared", "main"]);
  let safeThreadId = threadId;
  if (!safeThreadId || SHARED_BUCKETS.has(safeThreadId.trim().toLowerCase())) {
    safeThreadId = `ephem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    console.warn(`[chat] threadId ausente/shared (${threadId ?? "—"}) — usando ${safeThreadId}`);
  }
  const sessionId = `${userPrefix}::${safeThreadId}`;

  // 5. Loop multi-turn manual via fetch. Filtra eventos non-standard do
  //    Hermes (event: hermes.tool.progress) que quebrariam o SDK OpenAI.
  const encoder = new TextEncoder();
  let controllerClosed = false;
  const MAX_TURNS = 6;

  const readable = new ReadableStream({
    start(controller) {
      const enqueue = (data: Uint8Array) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(data);
        } catch {
          /* closed */
        }
      };
      // Heartbeat SSE: linha-comentário a cada 10s mantém o socket vivo no
      // Safari iOS / Chrome mobile, que cancelam fetches quando passa muito
      // tempo entre chunks (visto turnos do Hermes com 30-50s de gap entre
      // tool result e próxima geração). Cliente ignora linhas começando com
      // `:` (SSE spec). Limpo no close.
      const heartbeat = setInterval(() => {
        if (controllerClosed) return;
        enqueue(encoder.encode(": keepalive\n\n"));
      }, 1_000);
      const close = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };

      // Lembrete de sintaxe openui-lang inserido como mensagem `system` LOGO
      // ANTES da última mensagem do user. O catálogo completo já vai no system
      // prompt (referência), mas fica "longe" da pergunta — modelos seguem
      // melhor o que está próximo da resposta (saliência/recência). Esse
      // lembrete curto na posição saliente faz o agente usar a sintaxe exata
      // (Slice/Series posicionais, variantes válidas) em vez do prior comum de
      // libs de chart (label=/value=/color=/data=). Vale pra todos os profiles
      // waves — a library shadcn-genui é a mesma.
      const RENDER_SYNTAX_REMINDER =
        "Lembrete de sintaxe openui-lang (siga EXATAMENTE — é o único formato que renderiza; catálogo completo já está no system prompt). " +
        "Gráficos: PieChart([slices], donut?) e RadialChart([slices]) recebem Slice(category, value) posicional — NUNCA label=/value=/color=. " +
        "BarChart/LineChart/AreaChart(labels, [series], variant?, xLabel?, yLabel?) e RadarChart(labels, [series]) recebem Series(category, values) (values = lista de números). " +
        "variant de BarChart só 'grouped'|'stacked'. Gráficos NÃO têm título como argumento (título vai no CardHeader). " +
        "Tag(text, variant) e Badge: variant só default|secondary|destructive|outline|ghost (NUNCA info/success/warning — verde→secondary, vermelho→destructive). " +
        "Kanban/board: Kanban([colunas]) + KanbanColumn(name, color?, count?, [cards]) + KanbanCard(title, badges?, progress?, responsibleName?, tags?, id?) — NUNCA Columns/Column nem Card pra montar kanban. " +
        "Sequência/etapas/wizard: Steps([itens], currentStep?, title?) + StepsItem(title, details?, status?) (status pending|in_progress|completed|blocked) — não use Accordion pra isso. " +
        "Abas: Tabs([itens], default?) + TabItem(value, trigger, [conteúdo]). " +
        "Use apenas nomes reais de componentes (nada de CardBody, Chart, KPI, DataPoint, Markdown, Columns, Column). " +
        "FORMATO (obrigatório): emita openui-lang CRU, SEM cerca ``` nem bloco de código. UM statement por linha no estilo referência — `root = Card([a, b, c])` na 1ª linha e cada componente na sua própria linha (`a = CardHeader(...)`, `s1 = Slice(...)`). NUNCA aninhe componentes inline espalhados por várias linhas. Arrays (ex: rows do Table) ficam INLINE no argumento (`Table(columns=[...], rows=[[...],[...]])`) ou numa ÚNICA linha — nunca quebrados em várias linhas. badges e tags são listas de STRINGS (`badges=[\"Alta\"]`), nunca Badge()/Tag().";

      // índice da última mensagem `user` — inserimos o lembrete imediatamente
      // antes dela. Se não houver user (raro), o lembrete vai no fim.
      let _lastUserIdx = -1;
      for (let i = cleanMessages.length - 1; i >= 0; i--) {
        if ((cleanMessages[i] as Record<string, unknown>).role === "user") {
          _lastUserIdx = i;
          break;
        }
      }
      const conversation: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
      ];
      cleanMessages.forEach((m, i) => {
        if (i === _lastUserIdx) {
          conversation.push({ role: "system", content: RENDER_SYNTAX_REMINDER });
        }
        conversation.push(m);
      });
      if (_lastUserIdx === -1) {
        conversation.push({ role: "system", content: RENDER_SYNTAX_REMINDER });
      }

      const executors = Object.fromEntries(
        tools.map((t) => [t.function.name, t.function.function]),
      );

      let totalAssistantContent = "";
      let toolCallIdx = 0;
      // Tools `consult_*` (Vigia/Cronos/…) vistas no progress deste request —
      // o gateway executa o sub-agent internamente e NÃO devolve o job_id no
      // stream, então detectamos a chamada aqui e buscamos o job_id no .db pra
      // injetar o `check_job` (card "Vigia analisando…") de forma determinística.
      const consultToolsSeen = new Set<string>();
      // Backend de specialist do assistente ATUAL — resolvido pela PORTA do
      // gateway (extraída do baseURL, ex.: http://127.0.0.1:18877 → 18877).
      // Define qual rendered_api consultar/rotear e como mapear tool → profile.
      // Porta desconhecida/ausente → backend default (Steve).
      let gatewayPort: number | undefined;
      try {
        const pStr = new URL(baseURL ?? "").port;
        gatewayPort = pStr ? Number(pStr) : undefined;
      } catch {
        gatewayPort = undefined;
      }
      const specialistBackend = backendForPort(gatewayPort);
      // Acumula tokens da geração (somados entre turnos do loop).
      let usagePrompt = 0;
      let usageCompletion = 0;

      (async () => {
        try {
          console.log(`[chat:timing] ${elapsed()} - opening upstream to Hermes (${baseURL})`);
          for (let turn = 0; turn < MAX_TURNS; turn++) {
            const tUp = Date.now();
            const upstream = await fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                "X-Hermes-Session-Id": sessionId,
                ...(reasoningEffort ? { "X-Hermes-Reasoning-Effort": reasoningEffort } : {}),
                ...(agentId != null && agentId !== "" ? { "X-Hermes-Agent-Id": String(agentId) } : {}),
              },
              body: JSON.stringify({
                model: process.env.HERMES_MODEL || "hermes-agent",
                messages: conversation,
                tools: toolsSchemaForAPI.length > 0 ? toolsSchemaForAPI : undefined,
                stream: true,
                // Usage (tokens) só quando admin pediu — evita custo pra todos.
                ...(wantUsage ? { stream_options: { include_usage: true } } : {}),
              }),
            });

            if (!upstream.ok || !upstream.body) {
              const text = await upstream.text().catch(() => "(sem body)");
              enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    error: `Hermes ${upstream.status}: ${text.slice(0, 300)}`,
                  })}\n\n`,
                ),
              );
              break;
            }

            console.log(`[chat:timing] ${elapsed()} - upstream connected turn=${turn} (fetch took ${Date.now() - tUp}ms, status ${upstream.status})`);

            // Parse SSE stream linha-a-linha; filtra eventos non-standard,
            // acumula tool_calls que vierem via delta.tool_calls.
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let assistantText = "";
            const pendingToolCalls: Array<{
              id: string;
              name: string;
              arguments: string;
              index: number;
            }> = [];
            let finishReason: string | null = null;

            // Tracker do tipo de evento SSE atual. O Hermes intercala chunks
            // padrão (chat.completion.chunk em linhas "data: {...}") com
            // eventos custom (`event: hermes.tool.progress` seguido de
            // `data: {tool, label, status}`). Como SSE: a linha `event:` muda
            // o tipo da próxima `data:`.
            let nextEventType: string | null = null;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });

              const lines = buf.split("\n");
              buf = lines.pop() ?? ""; // resto

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) {
                  // Linha vazia = fim do bloco SSE. Reseta tipo de evento.
                  nextEventType = null;
                  continue;
                }
                if (line.startsWith("event:")) {
                  nextEventType = line.slice(6).trim();
                  continue;
                }
                if (!line.startsWith("data: ")) continue;

                // Bloco hermes.tool.progress → atualiza buffer global pro
                // ThinkingIndicator pollar via /api/chat/progress, e NÃO
                // repassa pro frontend (não é chat.completion.chunk).
                if (nextEventType === "hermes.tool.progress") {
                  try {
                    const p = JSON.parse(line.slice(6).trim()) as {
                      tool?: string;
                      emoji?: string;
                      label?: string;
                      toolCallId?: string;
                      status?: string;
                    };
                    if (p.tool) {
                      setProgress({
                        tool: p.tool,
                        emoji: p.emoji,
                        label: p.label,
                        toolCallId: p.toolCallId,
                        status: p.status === "completed" ? "completed" : "running",
                      });
                      if (isConsultTool(p.tool, specialistBackend)) consultToolsSeen.add(p.tool);
                    }
                  } catch {
                    // payload inválido — ignora
                  }
                  nextEventType = null;
                  continue;
                }
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") continue;

                let ev: {
                  choices?: Array<{
                    delta?: {
                      content?: string;
                      tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                    finish_reason?: string | null;
                  }>;
                  usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    input_tokens?: number;
                    output_tokens?: number;
                    total_tokens?: number;
                    total?: number;
                  };
                };
                try {
                  ev = JSON.parse(payload);
                } catch {
                  continue;
                }
                // Bloco de usage (chunk sem choices, vem no fim quando
                // include_usage). Acumula entre turnos.
                if (ev.usage) {
                  const prompt = Number(
                    ev.usage.prompt_tokens ?? ev.usage.input_tokens ?? 0,
                  );
                  const completion = Number(
                    ev.usage.completion_tokens ?? ev.usage.output_tokens ?? 0,
                  );
                  const total = Number(
                    ev.usage.total_tokens ??
                      ev.usage.total ??
                      prompt + completion,
                  );

                  // Alguns provedores só retornam total_tokens no stream final.
                  // Nesse caso, preserva a divisão conhecida (se houver) e evita
                  // zerar o badge de tokens.
                  usagePrompt += Number.isFinite(prompt) ? prompt : 0;
                  usageCompletion += Number.isFinite(completion) ? completion : 0;
                  if (
                    usagePrompt + usageCompletion === 0 &&
                    Number.isFinite(total) &&
                    total > 0
                  ) {
                    usageCompletion += total;
                  }
                }
                const choice = ev.choices?.[0];
                if (!choice) continue;
                const delta = choice.delta ?? {};
                if (typeof delta.content === "string" && delta.content) {
                  assistantText += delta.content;
                  // Pass-through pro frontend (formato chat.completions.chunk)
                  enqueue(
                    encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
                  );
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!pendingToolCalls[idx]) {
                      pendingToolCalls[idx] = {
                        id: tc.id ?? `call_${turn}_${idx}`,
                        name: tc.function?.name ?? "",
                        arguments: "",
                        index: idx,
                      };
                    }
                    if (tc.function?.name) {
                      pendingToolCalls[idx].name = tc.function.name;
                    }
                    if (typeof tc.function?.arguments === "string") {
                      pendingToolCalls[idx].arguments += tc.function.arguments;
                    }
                    if (tc.id) pendingToolCalls[idx].id = tc.id;
                  }
                }
                if (choice.finish_reason) {
                  finishReason = choice.finish_reason;
                }
              }
            }

            totalAssistantContent += assistantText;

            // Se não chamou tools, encerrou — sai do loop
            if (pendingToolCalls.length === 0 || finishReason === "stop") {
              break;
            }

            // Anota a mensagem do assistant + executa cada tool call → repassa
            // resultado pro próximo turno.
            const assistantMsg: Record<string, unknown> = {
              role: "assistant",
              content: assistantText || null,
              tool_calls: pendingToolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              })),
            };
            conversation.push(assistantMsg);

            for (const tc of pendingToolCalls) {
              // Emite tool_call_start + args pro frontend ver a chamada
              const tcId = `tc-${toolCallIdx}`;
              enqueue(
                sseToolCallStart(
                  encoder,
                  { id: tcId, function: { name: tc.name } },
                  toolCallIdx,
                ),
              );

              const exec = executors[tc.name];
              let resultStr: string;
              if (!exec) {
                resultStr = JSON.stringify({
                  error: true,
                  message: `Tool '${tc.name}' não disponível na spec da Waves.`,
                });
              } else {
                try {
                  const args =
                    tc.arguments && tc.arguments.length > 0
                      ? JSON.parse(tc.arguments)
                      : {};
                  resultStr = await exec(args as Record<string, unknown>);
                } catch (err) {
                  resultStr = JSON.stringify({
                    error: true,
                    message: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              enqueue(
                sseToolCallArgs(
                  encoder,
                  { id: tcId, function: { arguments: tc.arguments || "{}" } },
                  resultStr,
                  toolCallIdx,
                ),
              );
              toolCallIdx++;

              conversation.push({
                role: "tool",
                tool_call_id: tc.id,
                content: resultStr,
              });
            }
          }

          // FollowUps obrigatórios (segurança)
          const { content: patched, appended } = ensureFollowUps(
            totalAssistantContent,
            {},
          );
          if (appended && patched.length > totalAssistantContent.length) {
            const suffix = patched.slice(totalAssistantContent.length);
            enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chatcmpl-followups",
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: { content: suffix },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`,
              ),
            );
          }

          // Popula cache de form trigger com a resposta agregada (após
          // ensureFollowUps). Próximas requests com a mesma mensagem servem
          // direto do cache. Cache invalida se SOUL.md mudar.
          if (cacheTrigger) {
            const finalContent = appended ? patched : totalAssistantContent;
            setFormCached(cacheTrigger, finalContent);
          }

          // Limpa buffer de progress — request finalizada, frontend não
          // precisa mais mostrar tool em execução.
          clearProgress();

          // Marcador de usage (tokens da geração) — o frontend extrai e mostra
          // só pra admin. Vai como content num comentário HTML (o renderer e o
          // parser openui-lang ignoram; o GenUIAssistantMessage tira na exibição).
          if (usagePrompt > 0 || usageCompletion > 0) {
            console.log(
              `[chat:usage] thread=${safeThreadId} P:${usagePrompt} C:${usageCompletion} T:${usagePrompt + usageCompletion} (wantUsage=${wantUsage})`,
            );
            const marker = `\n<!--waves-usage:{"p":${usagePrompt},"c":${usageCompletion},"t":${usagePrompt + usageCompletion}}-->`;
            enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "chatcmpl-usage",
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: { content: marker }, finish_reason: null }],
                })}\n\n`,
              ),
            );
          } else if (wantUsage) {
            console.log(
              `[chat:usage] thread=${safeThreadId} 0 tok — sem usage (resposta nativa/sem chamada LLM ou gateway não reportou)`,
            );
          }

          // Card de specialist (Vigia/Cronos/…): o agente nem sempre emite o
          // marcador `check_job` no texto. Se um `consult_*` rodou neste request,
          // busca o job recém-criado via rendered_api (HTTP) e injeta o marcador —
          // o JobProgressCard monta sozinho (animação "analisando…" + auto-render
          // quando o sub-agent volta). Determinístico, sem depender do LLM.
          for (const tool of consultToolsSeen) {
            const profile = consultToolToProfile(tool, specialistBackend);
            const job = profile ? await getLatestJob(profile, specialistBackend) : null;
            if (job) {
              // Registra qual rendered_api tem esse job, pra o proxy
              // `/api/specialist-jobs/:id/rendered` rotear certo (o front polla
              // só com o job_id, sem saber o backend).
              rememberJobBackend(job.jobId, specialistBackend.renderedUrl);
              // Ancora o job na thread (server-side) pra o card SOBREVIVER ao
              // reload: o thread-history re-injeta o marcador no histórico. O
              // marcador injetado aqui no stream NÃO entra no state.db do gateway.
              // Chave = `sessionId` COMPLETO (waves-<tenant>-user-<id>::<thread>),
              // idêntico ao `threadId` que o thread-history recebe na leitura.
              recordJobAnchor(sessionId, job.jobId);
              enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: "chatcmpl-specialist",
                    object: "chat.completion.chunk",
                    choices: [
                      { index: 0, delta: { content: `\ncheck_job: "${job.jobId}"` }, finish_reason: null },
                    ],
                  })}\n\n`,
                ),
              );
              console.log(
                `[chat:specialist] ${tool} → job ${job.jobId} @ ${specialistBackend.renderedUrl} (check_job injetado)`,
              );
              break; // 1 card por request (parseCheckJob pega o 1º marcador)
            }
          }

          enqueue(encoder.encode("data: [DONE]\n\n"));
          close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[hermes] route error:", msg);
          enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
          );
          enqueue(encoder.encode("data: [DONE]\n\n"));
          close();
        }
      })();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ============================================================================
// Helpers de demo (resposta hardcoded sem LLM)
// ============================================================================

function findLastUserMessage(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m || m.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      // OpenAI multi-part format: [{type:"text", text:"..."}, ...]
      const text = c
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
            return (p as { text: string }).text;
          }
          return "";
        })
        .join("");
      if (text) return text;
    }
  }
  return null;
}

/**
 * Streama uma resposta OpenUI Lang fixa como SSE chat.completions, idêntico
 * ao que o frontend espera. Pula LLM totalmente.
 *
 * Chunkifica o conteúdo em pedaços de ~200 chars pra simular streaming
 * progressivo (o renderer openui-lang aproveita pra render line-by-line).
 */
function streamHardcodedOpenUI(content: string): Response {
  const encoder = new TextEncoder();
  const CHUNK = 220;

  const readable = new ReadableStream({
    start(controller) {
      const enqueue = (s: string) => controller.enqueue(encoder.encode(s));

      // role:assistant primeiro
      enqueue(
        `data: ${JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        })}\n\n`,
      );

      // chunks de content
      for (let off = 0; off < content.length; off += CHUNK) {
        const piece = content.slice(off, off + CHUNK);
        enqueue(
          `data: ${JSON.stringify({
            id: "chatcmpl-demo",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          })}\n\n`,
        );
      }

      // finish
      enqueue(
        `data: ${JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      enqueue("data: [DONE]\n\n");
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
