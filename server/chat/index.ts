/**
 * Orquestrador de chat — despacha requests para o handler correto
 * (Codex, Hermes ou OpenAI clássico) após pré-processamento.
 *
 * API pública: handleChatRequest, resolveHermesGateway.
 */
import {
  getOpenAiCredential,
  getOpenAiBaseUrl,
  getOpenAiProvider,
} from "../load-env.js";
import { DEFAULT_OPENAI_MODEL } from "../waves-prompt.js";
import { getActiveTenant } from "../tenants.js";
import { getDemoReport } from "../demo-reports.js";
import {
  getCached as getFormCached,
  isCacheableTrigger,
} from "../form-cache.js";
import { resolveHermesGateway } from "./hermes-gateway.js";
import type { ChatRequestBody } from "./types.js";
import { injectAttachments, sanitizeAttachments } from "./attachments.js";
import { buildScopeContext } from "./scope-context.js";
import {
  findLastUserMessage,
  streamHardcodedOpenUI,
} from "./sse-helpers.js";
import { handleChatRequestCodex } from "./handler-codex.js";
import { handleChatRequestOpenAI } from "./handler-openai.js";
import { handleChatRequestHermes } from "./handler-hermes.js";

export { resolveHermesGateway };

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

  // OpenAI clássico (fallback — qualquer provider que não é codex/hermes)
  return handleChatRequestOpenAI({
    apiKey,
    baseURL,
    model,
    messages,
    wavesSession,
    defaultWorkflowId,
    scopeContext,
  });
}
