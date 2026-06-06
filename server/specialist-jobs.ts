// Descobre o job_id que o `consult_*` acabou de criar, pra o waves_client montar
// o card "Vigia analisando…" de forma DETERMINÍSTICA (sem depender do LLM emitir
// o marcador `check_job`). Apps DESACOPLADAS: NÃO lê mais o specialist_jobs.db
// direto — consulta o rendered_api por HTTP (GET /specialist-jobs/latest), o
// mesmo serviço que já serve o /rendered. Prefixo de profile configurável por env.
const RENDERED_API_BASE = (
  process.env.RENDERED_API_URL ?? "http://127.0.0.1:18861"
).replace(/\/$/, "");

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
 * o do turno atual, não um antigo). Via HTTP no rendered_api (apps desacopladas).
 * Retorna null em qualquer erro/404 — o fluxo segue normal.
 */
export async function getLatestJob(
  profile: string,
  maxAgeSeconds = 60,
): Promise<SpecialistJob | null> {
  try {
    const url =
      `${RENDERED_API_BASE}/specialist-jobs/latest` +
      `?profile=${encodeURIComponent(profile)}&max_age=${maxAgeSeconds}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null; // 404 (none/stale), offline, etc.
    const j = (await r.json()) as {
      job_id?: string;
      status?: string;
      submitted_at?: string;
    };
    if (!j?.job_id) return null;
    return {
      jobId: j.job_id,
      status: String(j.status ?? ""),
      submittedAt: String(j.submitted_at ?? ""),
    };
  } catch {
    return null;
  }
}
