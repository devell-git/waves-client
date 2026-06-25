// Descobre o job_id que o `consult_*` acabou de criar (pra montar o card "…
// analisando…" DETERMINÍSTICAMENTE, sem depender do LLM emitir o marcador
// `check_job`) E ROTEIA o rendered_api correto POR ASSISTENTE.
//
// Cada assistente que usa sub-agentes especialistas tem o SEU rendered_api
// (Steve :18861, juridico :18977, …). O assistente é identificado pela PORTA do
// gateway do login (a mesma que o chat já usa). Apps DESACOPLADAS: NÃO lê o
// specialist_jobs.db direto — consulta o rendered_api por HTTP (GET
// /specialist-jobs/latest). Registry data-driven por env — SEM nome de cliente
// no código.

// ── Backend default (assistente primário; hoje o Steve/bioshield) ────────────
const DEFAULT_RENDERED_URL = (
  process.env.RENDERED_API_URL ?? "http://127.0.0.1:18861"
).replace(/\/+$/, "");
const DEFAULT_PROFILE_PREFIX = process.env.SPECIALIST_PROFILE_PREFIX ?? "bioshield-";
// Apelidos default (onde o nome da tool ≠ sufixo do profile).
const DEFAULT_ALIASES: Record<string, string> = {
  engineer: "engenheiro",
  treasurer: "tesoureiro",
  hr: "capital-humano",
};

export interface SpecialistBackend {
  /** Base HTTP do rendered_api desse assistente (sem barra final). */
  renderedUrl: string;
  /** Regex que extrai o sufixo do especialista do nome da tool (grupo 1). */
  toolRegex: RegExp;
  /** Prefixo do profile do sub-agente (ex.: "bioshield-", "juridico-"). */
  profilePrefix: string;
  /** Apelidos onde o sufixo da tool ≠ sufixo do profile. */
  aliases: Record<string, string>;
}

const DEFAULT_BACKEND: SpecialistBackend = {
  renderedUrl: DEFAULT_RENDERED_URL,
  // `consult_<x>` em qualquer posição (tolera prefixo do gateway:
  // `bioshield_consult_vigia`, `mcp__x__consult_vigia`).
  toolRegex: /consult_([a-z]+)/i,
  profilePrefix: DEFAULT_PROFILE_PREFIX,
  aliases: DEFAULT_ALIASES,
};

// ── Registry por PORTA de gateway (env SPECIALIST_BACKENDS, JSON) ─────────────
// Ex.: SPECIALIST_BACKENDS='[{"port":18877,
//        "rendered_url":"http://127.0.0.1:18977",
//        "tool_regex":"consultar_([a-z]+)","profile_prefix":"juridico-"}]'
// Porta ausente do registry → backend default (preserva o comportamento atual).
interface BackendEntry {
  port?: number;
  rendered_url?: string;
  tool_regex?: string;
  profile_prefix?: string;
  aliases?: Record<string, string>;
}

function parseBackends(): Map<number, SpecialistBackend> {
  const m = new Map<number, SpecialistBackend>();
  const raw = process.env.SPECIALIST_BACKENDS?.trim();
  if (!raw) return m;
  let arr: BackendEntry[];
  try {
    const parsed: unknown = JSON.parse(raw);
    arr = Array.isArray(parsed) ? (parsed as BackendEntry[]) : [];
  } catch (e) {
    console.error(
      `[specialist] SPECIALIST_BACKENDS inválido: ${(e as Error).message} — usando só o backend default.`,
    );
    return m;
  }
  for (const e of arr) {
    if (!e || typeof e.port !== "number" || !e.rendered_url) continue;
    let re: RegExp;
    try {
      re = e.tool_regex ? new RegExp(e.tool_regex, "i") : DEFAULT_BACKEND.toolRegex;
    } catch {
      console.error(
        `[specialist] tool_regex inválido p/ porta ${e.port}: "${e.tool_regex}" — pulando entrada.`,
      );
      continue;
    }
    m.set(e.port, {
      renderedUrl: e.rendered_url.replace(/\/+$/, ""),
      toolRegex: re,
      profilePrefix: e.profile_prefix ?? DEFAULT_PROFILE_PREFIX,
      aliases: e.aliases ?? {},
    });
  }
  if (m.size) {
    console.log(
      `[specialist] backends por porta: ${[...m.keys()].join(", ")} ` +
        `(default → ${DEFAULT_RENDERED_URL})`,
    );
  }
  return m;
}

const BY_PORT = parseBackends();

/** Backend de specialist do assistente, resolvido pela PORTA do gateway do login.
 * Porta desconhecida → backend default (não regride o assistente primário). */
export function backendForPort(port?: number): SpecialistBackend {
  if (typeof port === "number" && BY_PORT.has(port)) return BY_PORT.get(port)!;
  return DEFAULT_BACKEND;
}

export interface SpecialistJob {
  jobId: string;
  status: string;
  submittedAt: string;
}

/** `true` se a tool é um `consult_*` desse backend (filtro do stream). */
export function isConsultTool(
  toolName: string,
  backend: SpecialistBackend = DEFAULT_BACKEND,
): boolean {
  return backend.toolRegex.test(toolName.trim());
}

/** `consult_vigia` → `bioshield-vigia`; `consultar_contratual` → `juridico-contratual`.
 * Tolerante a prefixo do gateway (casa o padrão em qualquer posição). */
export function consultToolToProfile(
  toolName: string,
  backend: SpecialistBackend = DEFAULT_BACKEND,
): string | null {
  const m = backend.toolRegex.exec(toolName.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  return backend.profilePrefix + (backend.aliases[name] ?? name);
}

/**
 * Job mais recente de um profile, criado nos últimos `maxAgeSeconds` (pra pegar
 * o do turno atual, não um antigo). Via HTTP no rendered_api do `backend`.
 * Retorna null em qualquer erro/404 — o fluxo segue normal.
 */
export async function getLatestJob(
  profile: string,
  backend: SpecialistBackend = DEFAULT_BACKEND,
  maxAgeSeconds = 60,
): Promise<SpecialistJob | null> {
  try {
    const url =
      `${backend.renderedUrl}/specialist-jobs/latest` +
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

// ── Mapa jobId → rendered_api (aprendido na injeção; lido pelo proxy) ─────────
// O front polla `/api/specialist-jobs/<id>/rendered` só com o job_id; o proxy
// precisa saber QUAL rendered_api tem esse job. Registramos na injeção do
// marcador (mesmo processo do server). Cap simples FIFO p/ não crescer sem fim.
const JOB_BACKEND_MAX = 2000;
const jobBackend = new Map<string, string>();

export function rememberJobBackend(jobId: string, renderedUrl: string): void {
  if (!jobId || !renderedUrl) return;
  if (jobBackend.has(jobId)) return;
  if (jobBackend.size >= JOB_BACKEND_MAX) {
    const oldest = jobBackend.keys().next().value; // Map preserva ordem de inserção
    if (oldest !== undefined) jobBackend.delete(oldest);
  }
  jobBackend.set(jobId, renderedUrl);
}

/** rendered_api conhecido p/ esse job, ou null (o proxy decide o fallback). */
export function renderedUrlForJob(jobId: string): string | null {
  return jobBackend.get(jobId) ?? null;
}

/** Todas as bases de rendered_api conhecidas (default primeiro + registry),
 * deduplicadas. Usado pelo proxy pra RESOLVER um job fora do mapa (ex.: após
 * restart do server, ou job criado fora do fluxo de injeção) sondando cada uma. */
export function allRenderedBases(): string[] {
  const set = new Set<string>([DEFAULT_RENDERED_URL]);
  for (const b of BY_PORT.values()) set.add(b.renderedUrl);
  return [...set];
}
