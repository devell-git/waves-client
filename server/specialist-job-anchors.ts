// Âncoras server-side dos jobs de specialist (`check_job`) por thread.
//
// O marcador `check_job` é injetado no stream pelo server (chat.ts) e NÃO entra
// no histórico do gateway (state.db). Sem âncora, ao recarregar a página o card
// "analisando…/resultado" some. Aqui registramos {jobId, ts} por threadId e o
// `thread-history.getThreadMessages` re-injeta a mensagem-marcador no histórico
// servido — então o card volta naturalmente no reload (e em QUALQUER dispositivo,
// diferente do localStorage). O JobProgressCard então re-polla o rendered_api e
// serve o resultado do cache.
//
// Persistência: JSON em data/ (sobrevive a restart). Writer (chat.ts) e reader
// (thread-history.ts) são o MESMO processo → cache em memória compartilhado.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const FILE =
  process.env.SPECIALIST_ANCHORS_FILE ??
  join(process.cwd(), "data", "specialist-job-anchors.json");
const MAX_PER_THREAD = 30;

export interface JobAnchor {
  jobId: string;
  ts: number; // epoch ms — posição na conversa
}
type Store = Record<string, JobAnchor[]>; // threadId → anchors

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    cache = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf-8")) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(s: Store): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(s), "utf-8");
  } catch {
    /* disco cheio / readonly — só perde persistência entre restarts */
  }
}

/** Registra um job de specialist visto numa thread (idempotente). */
export function recordJobAnchor(threadId: string, jobId: string, ts?: number): void {
  if (!threadId || !jobId) return;
  const s = load();
  const list = s[threadId] ?? (s[threadId] = []);
  if (list.some((a) => a.jobId === jobId)) return; // dedup
  list.push({ jobId, ts: typeof ts === "number" && ts > 0 ? ts : Date.now() });
  if (list.length > MAX_PER_THREAD) s[threadId] = list.slice(-MAX_PER_THREAD);
  persist(s);
}

/** Jobs ancorados numa thread (pra re-injetar o card no histórico). */
export function jobAnchorsForThread(threadId: string): JobAnchor[] {
  if (!threadId) return [];
  return load()[threadId] ?? [];
}
