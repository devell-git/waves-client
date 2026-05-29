/**
 * ThinkingIndicator — mostra "Thinking" + progresso da tool em execução.
 *
 * (REFATORADO 2026-05-27, v2) Volta a pollar `/api/chat/progress`, mas
 * com cuidado:
 *   - Frequência baixa (2s, não 500ms) — em request de 30s dá ~15 polls,
 *     bem abaixo do limite de connection pool do browser (~6 concorrentes
 *     por origem).
 *   - Só polla enquanto `isRunning=true` (useThread).
 *   - AbortController garante que o fetch anterior é cancelado antes do
 *     próximo, evitando empilhamento se um poll demorar mais que 2s.
 *   - Backoff exponencial em erro (não satura se o endpoint cair).
 *
 * Quando há progresso (tool ativa), mostra `emoji + label` (ex:
 * `⚙️ Carregando manage-workflows...`). Sem progresso ativo, mostra
 * apenas `Thinking...` simples.
 */

import { useEffect, useState } from "react";
import { useThread } from "@openuidev/react-headless";

interface ToolProgress {
  tool: string;
  emoji?: string;
  label?: string;
  /** Mensagem em linguagem natural gerada pelo backend a partir do tool+label. */
  humanLabel?: string;
  toolCallId?: string;
  status: "running" | "completed";
  ts: number;
}

const POLL_INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 10_000;

export function ThinkingIndicator() {
  const isRunning = useThread((s) => s.isRunning);
  const [progress, setProgress] = useState<ToolProgress | null>(null);

  useEffect(() => {
    if (!isRunning) {
      setProgress(null);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortController: AbortController | null = null;
    let backoff = POLL_INTERVAL_MS;

    const poll = async () => {
      if (cancelled) return;
      abortController?.abort();
      abortController = new AbortController();
      try {
        const r = await fetch("/api/chat/progress", {
          signal: abortController.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { progress: ToolProgress | null };
        if (cancelled) return;
        setProgress(data.progress);
        backoff = POLL_INTERVAL_MS; // reset
      } catch (err) {
        // Aborto silencioso, erro de rede aplica backoff
        if (err instanceof Error && err.name === "AbortError") return;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, backoff);
      }
    };

    // Primeiro poll quase imediato pra não esperar 2s na primeira mostragem
    timeoutId = setTimeout(poll, 200);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      abortController?.abort();
    };
  }, [isRunning]);

  // Mensagem em linguagem natural — vem do backend já humanizada
  // ("Buscando os Action Plans…"). Se não tiver, fallback pra "Thinking".
  const message = progress?.humanLabel ?? "Pensando…";

  return (
    <div className="thinking-bubble" role="status" aria-live="polite">
      <span className="thinking-pulse" aria-hidden="true" />
      <span
        key={message /* força re-mount + transição quando muda */}
        className="thinking-bubble__text"
      >
        {message}
      </span>
    </div>
  );
}
