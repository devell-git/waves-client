import { useEffect, useRef, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { shadcnChatLibrary } from "../lib/shadcn-genui";

/**
 * Card de acompanhamento de job em background (consultas pesadas: Relatório MAP,
 * Mídias Negativas). Substitui o texto cru "check_job: <id>" que o agente emite.
 *
 * Faz polling de /api/specialist-jobs/:id/rendered:
 *   - queued/running → progress bar viva (tempo decorrido vs eta_s) + status
 *   - done           → renderiza o openui_lang resultante (mesmo shadcnChatLibrary)
 *   - error          → alerta de erro
 *
 * Robusto a reload: a mensagem persistida tem o check_job; ao remontar, o card
 * re-polla e o endpoint serve o resultado do cache (rendered_openui).
 */

const POLL_MS = 5_000;
const TICK_MS = 1_000;
const MAX_POLLS = 240; // ~20min a 5s

interface JobProgressCardProps {
  jobId: string;
  /** ETA inicial em segundos, extraída do texto do agente (fallback 300). */
  etaSeconds?: number;
  /** Renderer pro openui-lang final — injetado pra evitar import circular. */
  onActionContent?: (content: string, formState?: unknown, label?: string) => void;
}

type JobState =
  | { phase: "running"; etaS: number }
  | { phase: "done"; openui: string }
  | { phase: "error"; error: string };

// Store de módulo: sobrevive a remontagens do card (a lista de mensagens
// re-renderiza/remonta durante streaming+polling). Sem isto, startedAt/elapsed
// resetavam a cada render e a barra ficava travada perto de 0%.
const JOB_START = new Map<string, number>();
const JOB_RESULT = new Map<string, JobState>();

export function JobProgressCard({ jobId, etaSeconds = 300, onActionContent }: JobProgressCardProps) {
  // Ancora o início UMA vez por jobId (persistente entre remounts).
  if (!JOB_START.has(jobId)) JOB_START.set(jobId, Date.now());

  const [state, setState] = useState<JobState>(
    () => JOB_RESULT.get(jobId) ?? { phase: "running", etaS: etaSeconds },
  );
  const [elapsed, setElapsed] = useState(() => (Date.now() - (JOB_START.get(jobId) ?? Date.now())) / 1000);
  const pollsRef = useRef(0);

  // Tick local (1s) pra barra suave entre polls. Lê o startedAt do store.
  useEffect(() => {
    if (state.phase !== "running") return;
    const compute = () => setElapsed((Date.now() - (JOB_START.get(jobId) ?? Date.now())) / 1000);
    compute();
    const t = setInterval(compute, TICK_MS);
    return () => clearInterval(t);
  }, [state.phase, jobId]);

  // Poll do servidor (5s).
  useEffect(() => {
    if (state.phase !== "running") return;
    let cancelled = false;

    const poll = async () => {
      pollsRef.current += 1;
      if (pollsRef.current > MAX_POLLS) {
        if (!cancelled) setState({ phase: "error", error: "Tempo limite excedido ao aguardar o resultado." });
        return;
      }
      try {
        const r = await fetch(`/api/specialist-jobs/${encodeURIComponent(jobId)}/rendered`);
        if (!r.ok && (r.status === 404 || r.status >= 500)) {
          if (!cancelled) setState({ phase: "error", error: `Job não encontrado (HTTP ${r.status}).` });
          return;
        }
        const data = (await r.json()) as {
          status: string;
          openui_lang?: string;
          error?: string;
          eta_s?: number;
        };
        if (cancelled) return;
        if (data.status === "done" && data.openui_lang) {
          const done: JobState = { phase: "done", openui: data.openui_lang };
          JOB_RESULT.set(jobId, done);
          setState(done);
        } else if (data.status === "error" || data.status === "not_found") {
          const err: JobState = { phase: "error", error: data.error ?? "Falha no processamento." };
          JOB_RESULT.set(jobId, err);
          setState(err);
        } else if (typeof data.eta_s === "number") {
          // re-ancora o eta total = decorrido (do store) + restante do servidor.
          const el = (Date.now() - (JOB_START.get(jobId) ?? Date.now())) / 1000;
          setState({ phase: "running", etaS: Math.max(data.eta_s + el, 1) });
        }
      } catch {
        // erro de rede transiente → continua tentando
      }
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, state.phase]);

  if (state.phase === "done") {
    return (
      <Renderer
        response={state.openui}
        library={shadcnChatLibrary}
        onAction={(event) => {
          if (event.type === "continue_conversation" && onActionContent) {
            onActionContent(event.humanFriendlyMessage ?? "", event.formState, event.humanFriendlyMessage);
          }
        }}
      />
    );
  }

  if (state.phase === "error") {
    return (
      <div className="job-progress job-progress--error" role="alert">
        <div className="job-progress__title">Não foi possível concluir</div>
        <div className="job-progress__sub">{state.error}</div>
      </div>
    );
  }

  // Avanço pela razão tempo/eta (eta usado só p/ ritmo da barra, NÃO exibido).
  const pct = Math.min(95, Math.round((elapsed / state.etaS) * 100));

  return (
    <div className="job-progress job-progress--compact" aria-live="polite">
      <div className="job-progress__row">
        <span className="job-progress__spinner" aria-hidden="true" />
        <span className="job-progress__title">Consulta em andamento</span>
        <span className="job-progress__pct">{pct}%</span>
      </div>
      <div className="job-progress__bar">
        <div className="job-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Extrai jobId + eta de uma resposta do agente que contém `check_job: "<id>"`.
 * Robusto a aspas escapadas (`\"id\"`) — o agente emite o marcador dentro de
 * uma string openui-lang (ex.: `Tag("check_job: \"abc\"", ...)`), então as
 * aspas internas vêm escapadas. Também aceita eta em "420s" ou "420 segundos". */
export function parseCheckJob(content: string): { jobId: string; etaSeconds: number } | null {
  const m = content.match(/check_job\s*[:=]\s*\\?["']([a-zA-Z0-9]{6,})\\?["']/);
  if (!m) return null;
  const eta =
    content.match(/(\d{2,4})\s*segundos/) ||
    content.match(/(?:Previs[ãa]o|ETA|estimad[oa])[^0-9]{0,12}(\d{2,4})\s*s\b/i) ||
    content.match(/(\d{2,4})\s*s\b/);
  return { jobId: m[1], etaSeconds: eta ? Number(eta[1]) : 420 };
}
