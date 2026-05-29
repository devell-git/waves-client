/**
 * Cliente pro backend Codex (chatgpt.com/backend-api/codex).
 *
 * Por que existe: o backend Codex é diferente do OpenAI clássico em 3 dimensões:
 *  1. **Cloudflare challenge** — exige headers `originator: codex_cli_rs` +
 *     `User-Agent codex_cli_rs/...` + `ChatGPT-Account-ID` extraído do JWT
 *  2. **Endpoint `/responses`** (Responses API) em vez de `/chat/completions`
 *  3. **Schema diferente** — `input[]` em vez de `messages[]`; tools no formato
 *     top-level; tool calls vêm como `function_call` items; resultado como
 *     `function_call_output`
 *
 * Este módulo encapsula esses detalhes e expõe uma interface que coordena
 * o loop multi-turno de function-calling e emite eventos no formato que
 * `chat.ts` espera (compatível com o stream chat-completion clássico que
 * o frontend já consome).
 *
 * Referência: Hermes Agent (`agent/auxiliary_client.py:_codex_cloudflare_headers`
 * + `run_agent.py:1240`).
 */
import OpenAI from "openai";

/**
 * Extrai `chatgpt_account_id` do JWT do Codex (claim
 * `https://api.openai.com/auth.chatgpt_account_id`).
 * Retorna undefined se token é malformado.
 */
function extractChatGptAccountId(accessToken: string): string | undefined {
  if (typeof accessToken !== "string" || !accessToken.trim()) return undefined;
  const parts = accessToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    let payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payloadB64.length % 4 !== 0) payloadB64 += "=";
    const decoded = Buffer.from(payloadB64, "base64").toString("utf-8");
    const claims = JSON.parse(decoded);
    const auth = claims["https://api.openai.com/auth"];
    const acct = auth && (auth.chatgpt_account_id as string | undefined);
    if (typeof acct === "string" && acct) return acct;
  } catch {
    /* token malformado — segue sem o header */
  }
  return undefined;
}

/**
 * Headers que burlam o Cloudflare challenge do endpoint codex backend.
 * Espelha `_codex_cloudflare_headers` do Hermes.
 */
export function buildCodexHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "codex_cli_rs/0.0.0 (waves-react)",
    originator: "codex_cli_rs",
  };
  const acct = extractChatGptAccountId(accessToken);
  if (acct) headers["ChatGPT-Account-ID"] = acct;
  return headers;
}

/**
 * Constrói cliente OpenAI configurado pro Codex backend.
 */
export function buildCodexClient(accessToken: string, baseURL: string): OpenAI {
  return new OpenAI({
    apiKey: accessToken,
    baseURL,
    defaultHeaders: buildCodexHeaders(accessToken),
  });
}

// ============================================================================
// Responses API — schema types e helpers
// ============================================================================

/**
 * Item de input pra Responses API. Aceita os principais shapes que precisamos.
 * SDK openai tem types mais ricos; usamos `unknown[]` no contrato externo
 * e narrowing aqui pra evitar acoplamento profundo.
 */
type ResponsesInputItem =
  | { role: "system" | "user"; content: Array<{ type: "input_text"; text: string }> }
  | {
      role: "assistant";
      content: Array<{ type: "output_text"; text: string }>;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

/**
 * Tool no formato Responses API (sem wrapper `function: {...}`).
 */
export interface CodexTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Mensagem genérica do chat (compatível com o que o frontend manda).
 */
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * Converte messages (sem system — esse vai como `instructions` separado)
 * pra input[] da Responses API.
 *
 * No Responses API, system prompt NÃO vai no input[] — é campo top-level
 * `instructions`. Mensagens de role "system" são filtradas aqui.
 */
export function messagesToResponsesInput(
  messages: ChatMessage[],
): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      // Ignora — vai como `instructions` no nível top de responses.create
      continue;
    } else if (m.role === "user") {
      out.push({
        role: "user",
        content: [{ type: "input_text", text: String(m.content ?? "") }],
      });
    } else if (m.role === "assistant") {
      const text = String(m.content ?? "");
      if (text) {
        out.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
    }
    // role "tool" é ignorado — gerenciamos function_call_output server-side
  }
  return out;
}

/**
 * Converte tools no formato chat.completions clássico (`{type, function: {name, parameters}}`)
 * pra formato Responses API (top-level name/parameters).
 */
export function toolsToResponsesFormat(
  classicTools: Array<{
    type: string;
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>,
): CodexTool[] {
  return classicTools.map((t) => ({
    type: "function" as const,
    name: t.function.name,
    description: t.function.description ?? "",
    parameters: t.function.parameters ?? { type: "object", properties: {}, required: [] },
  }));
}

// ============================================================================
// Loop multi-turno de function-calling
// ============================================================================

export interface ToolExecution {
  /** name → função async que recebe args parseados e devolve resultado (qualquer JSON-serializable) */
  [name: string]: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface CodexRunOptions {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools: CodexTool[];
  executors: ToolExecution;
  maxTurns?: number;
  /** Callback de stream — emite eventos compatíveis com chat.completions clássico */
  onContentDelta?: (text: string) => void;
  onToolCallStart?: (call: { id: string; name: string; index: number }) => void;
  onToolCallResult?: (call: {
    id: string;
    name: string;
    args: string;
    result: string;
    index: number;
  }) => void;
  onEnd?: (finalContent: string) => void;
  onError?: (err: Error) => void;
}

interface PendingCall {
  call_id: string;
  name: string;
  argumentsText: string;
}

/**
 * Coordena execução multi-turno do chat via Responses API.
 *
 * Loop:
 *  1. Envia input → Responses
 *  2. Coleta stream: texto vai pro onContentDelta; function_calls vão pro pendingCalls
 *  3. Se há pendingCalls → executa, anexa function_call/function_call_output ao input → loop
 *  4. Se não há mais → onEnd
 */
export async function runCodexChat(opts: CodexRunOptions): Promise<void> {
  const {
    client,
    model,
    systemPrompt,
    messages,
    tools,
    executors,
    maxTurns = 8,
    onContentDelta,
    onToolCallStart,
    onToolCallResult,
    onEnd,
    onError,
  } = opts;

  let assistantContent = "";
  let toolIndex = 0;

  // Responses API: system prompt vai como `instructions` (campo top-level),
  // não no input[]. Histórico user/assistant vai no input.
  let inputItems = messagesToResponsesInput(messages);

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const pendingCalls: PendingCall[] = [];
      // Os eventos function_call_arguments.* usam `item_id` (formato fc_...),
      // NÃO `call_id` (formato call_...). Mantenho ambos os mappings.
      const accumulatedArgs = new Map<string, string>(); // item_id → args buffer
      const callNames = new Map<string, string>(); // item_id → name
      const callIds = new Map<string, string>(); // item_id → call_id

      // Stream da Responses API
      // SDK type é complexo; usamos cast pra unknown e narrow nos eventos
      const stream = (await (client as unknown as {
        responses: { create: (opts: unknown) => Promise<AsyncIterable<unknown>> };
      }).responses.create({
        model,
        instructions: systemPrompt,
        input: inputItems,
        tools,
        stream: true,
        // Codex backend (ChatGPT account) exige store=false — não armazena
        // sessão server-side como o OpenAI API tradicional faz.
        store: false,
      })) as AsyncIterable<unknown>;

      for await (const ev of stream) {
        const e = ev as { type?: string; [k: string]: unknown };
        const type = e.type;

        // Texto: delta
        if (type === "response.output_text.delta") {
          const delta = e.delta as string | undefined;
          if (delta) {
            assistantContent += delta;
            onContentDelta?.(delta);
          }
          continue;
        }

        // Function call iniciada — chega `item` com .id (fc_...) e .call_id (call_...)
        if (type === "response.output_item.added") {
          const item = e.item as
            | {
                id?: string;
                type?: string;
                call_id?: string;
                name?: string;
              }
            | undefined;
          if (item?.type === "function_call" && item.id && item.call_id && item.name) {
            // IMPORTANTE: indexa por item.id (fc_...) — é o que vem nos eventos
            // function_call_arguments.{delta,done} subsequentes (`item_id` field).
            // O call_id (call_...) é diferente e usado só pra function_call_output.
            callNames.set(item.id, item.name);
            callIds.set(item.id, item.call_id);
            accumulatedArgs.set(item.id, "");
            onToolCallStart?.({ id: item.call_id, name: item.name, index: toolIndex });
            toolIndex++;
          }
          continue;
        }

        // Function call arguments — streamed (item_id = fc_..., não call_id)
        if (type === "response.function_call_arguments.delta") {
          const itemId = e.item_id as string | undefined;
          const delta = e.delta as string | undefined;
          if (itemId && delta) {
            accumulatedArgs.set(itemId, (accumulatedArgs.get(itemId) ?? "") + delta);
          }
          continue;
        }

        // Function call completo (item_id = fc_...)
        if (type === "response.function_call_arguments.done") {
          const itemId = e.item_id as string | undefined;
          if (!itemId) continue;
          const args =
            (e.arguments as string | undefined) ??
            accumulatedArgs.get(itemId) ??
            "";
          const name = callNames.get(itemId);
          const callId = callIds.get(itemId);
          if (callId && name) {
            pendingCalls.push({ call_id: callId, name, argumentsText: args });
          }
          continue;
        }

        // Stream terminou esta volta
        if (type === "response.completed" || type === "response.done") {
          break;
        }

        // Erro
        if (type === "response.failed" || type === "error") {
          throw new Error(
            `Codex stream error: ${JSON.stringify(e).slice(0, 300)}`,
          );
        }
      }

      // Se não há tool calls, fim
      if (pendingCalls.length === 0) {
        onEnd?.(assistantContent);
        return;
      }

      // Executa tool calls e adiciona ao input pro próximo turno
      for (const call of pendingCalls) {
        const executor = executors[call.name];
        let resultStr: string;
        if (!executor) {
          resultStr = JSON.stringify({ error: `tool ${call.name} não implementada` });
        } else {
          try {
            const args = call.argumentsText ? JSON.parse(call.argumentsText) : {};
            const result = await executor(args);
            resultStr =
              typeof result === "string" ? result : JSON.stringify(result);
          } catch (err) {
            resultStr = JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        onToolCallResult?.({
          id: call.call_id,
          name: call.name,
          args: call.argumentsText,
          result: resultStr,
          index: toolIndex - pendingCalls.length + pendingCalls.indexOf(call),
        });

        // Adiciona ao input: function_call + function_call_output
        inputItems.push({
          type: "function_call",
          call_id: call.call_id,
          name: call.name,
          arguments: call.argumentsText,
        });
        inputItems.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: resultStr,
        });
      }
      // próximo turno — Responses API vai gerar a resposta baseada nas outputs
    }

    // Excedeu maxTurns
    onEnd?.(assistantContent);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    onError?.(e);
  }
}
