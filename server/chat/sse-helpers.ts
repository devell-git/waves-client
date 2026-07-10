/**
 * Helpers SSE para emissão de tool calls e respostas hardcoded.
 *
 * Extraídos de server/chat.ts (split fatia 3).
 */

// ---------------------------------------------------------------------------
// sseToolCallStart / sseToolCallArgs
// ---------------------------------------------------------------------------

export function sseToolCallStart(
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

export function sseToolCallArgs(
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

// ---------------------------------------------------------------------------
// findLastUserMessage
// ---------------------------------------------------------------------------

export function findLastUserMessage(messages: unknown[]): string | null {
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

// ---------------------------------------------------------------------------
// streamHardcodedOpenUI
// ---------------------------------------------------------------------------

/**
 * Streama uma resposta OpenUI Lang fixa como SSE chat.completions, idêntico
 * ao que o frontend espera. Pula LLM totalmente.
 *
 * Chunkifica o conteúdo em pedaços de ~200 chars pra simular streaming
 * progressivo (o renderer openui-lang aproveita pra render line-by-line).
 */
export function streamHardcodedOpenUI(content: string): Response {
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
