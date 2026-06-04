// Leitura READ-ONLY do banco de jobs de specialist (sub-agentes Vigia/Cronos/…).
// NÃO modifica nada no Hermes — só lê o arquivo .db pra descobrir o job_id que
// o `consult_*` acabou de criar, e assim o waves_client consegue montar o card
// "Vigia analisando…" de forma DETERMINÍSTICA (sem depender do LLM emitir o
// marcador `check_job`). Path e prefixo de profile são configuráveis por env.
import { DatabaseSync } from "node:sqlite";

const DB_PATH =
  process.env.SPECIALIST_JOBS_DB ??
  "/home/bot/.hermes/shared-knowledge/bioshield/state/specialist_jobs.db";

// `consult_<x>` → profile do sub-agente. Prefixo default = bioshield-.
const PROFILE_PREFIX = process.env.SPECIALIST_PROFILE_PREFIX ?? "bioshield-";
// Apelidos onde o nome da tool ≠ sufixo do profile.
const ALIASES: Record<string, string> = {
  engineer: "engenheiro",
  treasurer: "tesoureiro",
  hr: "capital-humano",
};

export interface SpecialistJob {
  jobId: string;
  status: string;
  submittedAt: string;
}

/** `consult_vigia` → `bioshield-vigia`; `consult_engineer` → `bioshield-engenheiro`.
 * Tolerante a prefixo do gateway (ex.: `bioshield_consult_vigia`, `mcp__x__consult_vigia`)
 * — casa `consult_<nome>` em qualquer posição. */
export function consultToolToProfile(toolName: string): string | null {
  const m = /consult_([a-z]+)/i.exec(toolName.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  return PROFILE_PREFIX + (ALIASES[name] ?? name);
}

/**
 * Job mais recente de um profile, criado nos últimos `maxAgeSeconds` (pra pegar
 * o do turno atual, não um antigo). Read-only — não trava o daemon que escreve.
 * Retorna null em qualquer erro (DB ausente, etc.) — o fluxo segue normal.
 */
export function getLatestJob(profile: string, maxAgeSeconds = 60): SpecialistJob | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    const row = db
      .prepare(
        "SELECT job_id, status, submitted_at FROM jobs WHERE profile = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(profile) as
      | { job_id?: string; status?: string; submitted_at?: string }
      | undefined;
    if (!row?.job_id) return null;
    if (row.submitted_at) {
      const age = (Date.now() - new Date(row.submitted_at).getTime()) / 1000;
      if (Number.isFinite(age) && age > maxAgeSeconds) return null; // job velho — não é deste turno
    }
    return {
      jobId: row.job_id,
      status: String(row.status ?? ""),
      submittedAt: String(row.submitted_at ?? ""),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}
