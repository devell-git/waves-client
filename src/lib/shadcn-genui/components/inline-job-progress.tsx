import { useEffect, useState } from "react";

/**
 * InlineJobProgress — barra de progresso "viva" para a 2ª chamada de LLM que os
 * componentes genui disparam por conta própria (AnalysisReport, leitura analítica
 * do executivo, etc.), DEPOIS que o turno do chat já terminou.
 *
 * Nesse momento o thread não está mais `isRunning`, então o ThinkingIndicator
 * ("Pensando…") já sumiu e cada componente caía num spinner estático. Aqui
 * reusamos o MESMO visual do JobProgressCard (classes `job-progress__*`), mas
 * sem o pipeline de jobs em background: não há jobId/ETA real, então a barra é
 * sintética — avança pela razão tempo-decorrido/eta e satura em 95% até o
 * resultado chegar (mesma técnica de ritmo do JobProgressCard).
 *
 * Puramente visual: o componente que monta a chamada continua dono do fetch e
 * troca este loading pelo resultado quando termina.
 */
export function InlineJobProgress({
  label,
  /** Estimativa só para o RITMO da barra (não exibida). Análise via LLM ~25s. */
  etaSeconds = 25,
}: {
  label: string;
  etaSeconds?: number;
}) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const compute = () => setElapsed((Date.now() - startedAt) / 1000);
    compute();
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const pct = Math.min(95, Math.round((elapsed / Math.max(etaSeconds, 1)) * 100));

  return (
    <div className="job-progress job-progress--compact" aria-live="polite">
      <div className="job-progress__row">
        <span className="job-progress__spinner" aria-hidden="true" />
        <span className="job-progress__title">{label}</span>
        <span className="job-progress__pct">{pct}%</span>
      </div>
      <div className="job-progress__bar">
        <div className="job-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
