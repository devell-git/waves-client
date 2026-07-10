/**
 * Handler do branch OpenAI clássico (runTools + SSE).
 *
 * Extraído de server/chat.ts (split fatia 7).
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import {
  ensureFollowUps,
  extractWorkflowIdFromToolCalls,
} from "../openui-postprocess.js";
import { buildWavesSystemPrompt } from "../waves-prompt.js";
import type { WavesSession } from "../waves-client.js";
import { sseToolCallStart, sseToolCallArgs } from "./sse-helpers.js";
import { createTools } from "./tools-waves.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandleOpenAIOptions {
  apiKey: string;
  baseURL: string | undefined;
  model: string;
  messages: unknown[];
  wavesSession: WavesSession;
  defaultWorkflowId?: number;
  scopeContext?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleChatRequestOpenAI(opts: HandleOpenAIOptions): Promise<Response> {
  const {
    apiKey,
    baseURL,
    model,
    messages,
    wavesSession,
    defaultWorkflowId,
    scopeContext = "",
  } = opts;

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
