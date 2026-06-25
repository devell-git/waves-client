import { useEffect, useRef, useSyncExternalStore } from "react";
import { getThreadMessages, type ThreadMessage } from "../api/threads";

/**
 * Estado de execuções/jobs POR THREAD — vive FORA do store da lib
 * (`@openuidev/react-headless`), que só conhece a thread ATIVA (`isRunning`
 * global, `messages` da ativa). Esse acoplamento é o que fazia o "pensando" e
 * os jobs de uma thread VAZAREM para outra ao trocar de chat (#828).
 *
 * Aqui rastreamos, fora do store da lib:
 *  - `runningThreadId`: a thread (curta) que tem um run de LLM em voo.
 *  - `pendingJobsByThread`: jobs (`check_job`) ainda em andamento, por thread.
 *
 * Consumido por: ThinkingIndicator (escopa o "pensando" à thread originadora),
 * JobProgressCard (registra/limpa job pendente) e SidebarThreadHistory (badge).
 */

let runningThreadId: string | null = null;
const pendingJobsByThread = new Map<string, Set<string>>();
// #829 — runs que CONTINUAM no GATEWAY mesmo se você navegar. O waves_client não
// aborta o upstream (sem `signal`; `enqueue` faz no-op no disconnect), então o
// gateway termina de gerar e PERSISTE a resposta na thread — o run NÃO se perde.
// Aqui só rastreamos pra: (a) manter o badge na thread enquanto roda em bg, e
// (b) detectar a conclusão (poll no histórico) pra limpar/recarregar.
const backgroundRuns = new Map<string, { startedAt: number }>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getVersion(): number {
  return version;
}

// ── Run de LLM em voo ────────────────────────────────────────────────
export function setRunningThread(threadId: string | null): void {
  if (runningThreadId === threadId) return;
  runningThreadId = threadId;
  emit();
}
export function clearRunningThread(threadId?: string): void {
  // só limpa se for a thread marcada (evita corrida entre runs distintos)
  if (threadId != null && runningThreadId !== threadId) return;
  if (runningThreadId === null) return;
  runningThreadId = null;
  emit();
}

// ── Jobs (check_job) pendentes por thread ────────────────────────────
export function markJobPending(threadId: string, jobId: string): void {
  if (!threadId || !jobId) return;
  let s = pendingJobsByThread.get(threadId);
  if (!s) {
    s = new Set();
    pendingJobsByThread.set(threadId, s);
  }
  if (s.has(jobId)) return;
  s.add(jobId);
  emit();
}
export function clearJobPending(threadId: string, jobId: string): void {
  const s = pendingJobsByThread.get(threadId);
  if (!s || !s.has(jobId)) return;
  s.delete(jobId);
  if (s.size === 0) pendingJobsByThread.delete(threadId);
  emit();
}

// ── Runs em background por thread (#829) ─────────────────────────────
export function markBackgroundRun(threadId: string): void {
  if (!threadId || backgroundRuns.has(threadId)) return;
  backgroundRuns.set(threadId, { startedAt: Date.now() });
  emit();
}
export function clearBackgroundRun(threadId: string): void {
  if (backgroundRuns.delete(threadId)) emit();
}

// ── Conjunto de threads "ocupadas" (run em voo OU job pendente OU bg) ──
let cachedSet: ReadonlySet<string> = new Set();
let cachedSetKey = "\0";
function busySnapshot(): ReadonlySet<string> {
  const ids = new Set<string>();
  if (runningThreadId) ids.add(runningThreadId);
  for (const [tid, s] of pendingJobsByThread) if (s.size) ids.add(tid);
  for (const tid of backgroundRuns.keys()) ids.add(tid);
  const key = [...ids].sort().join("|");
  // devolve referência ESTÁVEL enquanto o conteúdo não muda — exigência do
  // useSyncExternalStore (snapshot instável → loop infinito de render).
  if (key !== cachedSetKey) {
    cachedSetKey = key;
    cachedSet = ids;
  }
  return cachedSet;
}

export function useBusyThreads(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, busySnapshot, busySnapshot);
}
export function useRunningThreadId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => runningThreadId,
    () => runningThreadId,
  );
}

/**
 * Vigia em background os `check_job` pendentes (mesmo quando você NÃO está na
 * thread onde o job roda) e limpa o badge quando o job termina — assim o alerta
 * na sidebar reflete o estado real. Montar UMA vez dentro do ChatProvider.
 */
const WATCH_MS = 30_000;
export function useBackgroundJobWatcher(): void {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const entries: Array<[string, string]> = [];
      for (const [tid, s] of pendingJobsByThread) for (const jid of s) entries.push([tid, jid]);
      for (const [tid, jid] of entries) {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/specialist-jobs/${encodeURIComponent(jid)}/rendered`);
          if (!r.ok) {
            if (r.status === 404 || r.status >= 500) clearJobPending(tid, jid);
            continue;
          }
          const d = (await r.json()) as { status?: string };
          if (d.status === "done" || d.status === "error" || d.status === "not_found") {
            clearJobPending(tid, jid);
          }
        } catch {
          /* rede transiente — tenta no próximo tick */
        }
      }
    };
    const id = setInterval(() => void tick(), WATCH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [v]);
}

/**
 * #829 — vigia os runs em BACKGROUND (thread que você deixou rodando ao navegar).
 * O gateway persiste a resposta na thread mesmo sem o cliente; aqui pollamos o
 * histórico e, quando uma NOVA mensagem do assistant aparece, o run terminou:
 * limpamos o badge e, se a thread terminada é a ATIVA, recarregamos pra mostrar
 * o resultado. Best-effort: se o fetch falhar, cai no timeout de segurança.
 * Montar UMA vez dentro do ChatProvider.
 */
const RUN_WATCH_MS = 6_000;
const RUN_MAX_MS = 5 * 60_000; // teto de segurança: limpa mesmo sem detectar

export function useBackgroundRunWatcher(opts: {
  profileId: string;
  threadKeyPrefix: string;
  activeThreadId: string;
  onActiveThreadDone?: (messages: ThreadMessage[]) => void;
}): void {
  const { profileId, threadKeyPrefix, activeThreadId, onActiveThreadDone } = opts;
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const baselineRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // higiene: descarta baselines de bg-runs que já saíram (evita baseline
      // velho ser reusado se a MESMA thread iniciar um run novo depois).
      for (const k of [...baselineRef.current.keys()]) {
        if (!backgroundRuns.has(k)) baselineRef.current.delete(k);
      }
      for (const [shortId, info] of [...backgroundRuns]) {
        if (cancelled) return;
        if (Date.now() - info.startedAt > RUN_MAX_MS) {
          clearBackgroundRun(shortId);
          baselineRef.current.delete(shortId);
          continue;
        }
        try {
          const msgs = await getThreadMessages(profileId, `${threadKeyPrefix}${shortId}`);
          const assistantCount = msgs.filter(
            (m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim(),
          ).length;
          const baseline = baselineRef.current.get(shortId);
          if (baseline == null) {
            baselineRef.current.set(shortId, assistantCount); // 1ª medida = baseline
            continue;
          }
          if (assistantCount > baseline) {
            // resposta persistida → run concluído em background.
            clearBackgroundRun(shortId);
            baselineRef.current.delete(shortId);
            if (shortId === activeThreadId) onActiveThreadDone?.(msgs);
          }
        } catch {
          /* rede transiente — tenta no próximo tick (timeout cobre o pior caso) */
        }
      }
    };
    const id = setInterval(() => void tick(), RUN_WATCH_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [v, profileId, threadKeyPrefix, activeThreadId, onActiveThreadDone]);
}
