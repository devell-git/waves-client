/**
 * Handler do branch Codex (Responses API + CF headers + multi-turno manual).
 *
 * Extraído de server/chat.ts (split fatia 6).
 */
import {
  buildCodexClient,
  runCodexChat,
} from "../codex-client.js";
import {
  ensureFollowUps,
  extractWorkflowIdFromToolCalls,
} from "../openui-postprocess.js";
import { buildWavesSystemPrompt } from "../waves-prompt.js";
import type { WavesSession } from "../waves-client.js";
import { createCodexToolsAndExecutors } from "./tools-waves.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandleCodexOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: unknown[];
  wavesSession: WavesSession;
  defaultWorkflowId?: number;
  scopeContext?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleChatRequestCodex(opts: HandleCodexOptions): Promise<Response> {
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
