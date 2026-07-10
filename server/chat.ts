import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
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
import {
  HERMES_STREAM_TIMEOUT_MS,
  resolveHermesGateway,
} from "./chat/hermes-gateway.js";
import type {
  ChatRequestBody,
  UserInfo,
  UserScopePayload,
} from "./chat/types.js";
export { resolveHermesGateway };
import { injectAttachments, sanitizeAttachments } from "./chat/attachments.js";
import { buildScopeContext } from "./chat/scope-context.js";
import {
  sseToolCallStart,
  sseToolCallArgs,
  findLastUserMessage,
  streamHardcodedOpenUI,
} from "./chat/sse-helpers.js";
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

export async function handleChatRequest(body: ChatRequestBody): Promise<Response> {
  const { messages, wavesSession, defaultWorkflowId } = body;

  // Injeta o texto extraído dos anexos na última mensagem do user (antes de
  // detectar demo/cache triggers e de despachar pro provider). Antes disso,
  // valida cada anexo contra o dono (URL assinada + containment em
  // uploads/<tenant>/<owner>/) pra o servidor nunca ler arquivo fora do escopo.
  if (body.attachments?.length) {
    const safe = sanitizeAttachments(body.attachments, getActiveTenant().id);
    injectAttachments(messages, safe);
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
              // Guarda contra socket pendurado (upstream que nunca responde/fecha).
              // Generoso de propósito: uma geração real com tools pode levar minutos,
              // então NÃO cortamos streams legítimos — só conexões travadas.
              signal: AbortSignal.timeout(HERMES_STREAM_TIMEOUT_MS),
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
                      setProgress(sessionId, {
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

          // Limpa buffer de progress DESTA sessão — request finalizada,
          // frontend não precisa mais mostrar tool em execução.
          clearProgress(sessionId);

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

