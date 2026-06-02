/**
 * toolProvider GENÉRICO pro runtime OpenUI (fluxo EXECUTE — sem LLM).
 *
 * Lê `/api/openui/spec` (29 tools nativas da Waves) e monta um map
 * `{ tool_name: async(args) => result }` que o `<Renderer toolProvider>` usa
 * pra resolver `Query()`/`Mutation()` — chamando o endpoint de cada tool direto
 * na Waves (via o proxy `/api/waves/*`, que injeta o X-API-KEY e repassa o
 * Bearer do usuário). É dirigido pela SPEC, então vale pra QUALQUER cliente/
 * tenant — nada hardcoded.
 *
 * Resultados são cacheados por (tool, args) com TTL curto → "dados já em cache":
 * o kanban carrega uma vez e listar/filtrar reaproveita sem novo fetch.
 */
import { loadSession } from "./session";

interface SpecToolEndpoint {
  method: string;
  path: string; // ex.: /api/openui/tools/workflows/kanban
}
interface SpecTool {
  name: string;
  endpoint?: SpecToolEndpoint;
}
interface OpenUISpec {
  tools?: SpecTool[];
}

export type ToolProvider = Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
>;

const RESULT_TTL_MS = 60_000;
const resultCache = new Map<string, { at: number; data: unknown }>();

function authHeaders(): Record<string, string> {
  const s = loadSession();
  return s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {};
}

async function callTool(
  tool: SpecTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ep = tool.endpoint!;
  const key = `${tool.name}:${JSON.stringify(args ?? {})}`;
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.data;

  // /api/openui/tools/... → /api/waves/openui/tools/... (o proxy tira o /api).
  const path = ep.path.replace(/^\/api/, "");
  let url = `/api/waves${path}`;
  const init: RequestInit = { method: ep.method, headers: { ...authHeaders() } };

  if (ep.method.toUpperCase() === "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args ?? {})) {
      if (v != null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  } else {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(args ?? {});
  }

  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      (data as { message?: string })?.message || `Tool ${tool.name}: HTTP ${r.status}`,
    );
  }
  resultCache.set(key, { at: Date.now(), data });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// Query de Agregação (sintética) — soma estatísticas dos N workflows NO RUNTIME.
//
// A API Waves não tem endpoint global de agregação: só `workflows/{id}/
// statistics/overview` por workflow (dá `overdue_tasks`, `by_status`, etc.).
// Contar "tasks em atraso do projeto" exigia o agente iterar os ~30 APs →
// 30+ tool results na sessão do Hermes (lento/caro). Aqui a iteração acontece
// no NAVEGADOR (client-side), com limite de concorrência e cache — nada entra
// na sessão. O agente só emite `Query("get_project_overview", {})` + componente.
// ─────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** GET cru no proxy /api/waves, com retry/backoff em 429 (rate-limit da Waves). */
async function rawGet(path: string, tries = 3): Promise<unknown> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const r = await fetch(`/api/waves${path}`, { headers: { ...authHeaders() } });
    if (r.status === 429 && attempt < tries - 1) {
      // backoff: 0.4s, 0.8s, 1.6s (+ respeita Retry-After se vier)
      const ra = Number(r.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * 2 ** attempt;
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }
    return r.json().catch(() => ({}));
  }
  return {};
}

/** Executa `fn` sobre `items` com no máx. `limit` em paralelo (evita 429). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = undefined as unknown as R;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface OverviewRow {
  id: number;
  name: string;
  overdue: number;
  total: number;
}

const overviewCache = new Map<string, { at: number; data: unknown }>();

/**
 * Agrega `statistics/overview` de todos os workflows. Retorna
 * `{ totals: {overdue, total, workflows}, rows: [{id, name, overdue, total}] }`
 * — pronto pra um componente ProjectOverview renderizar.
 */
async function aggregateProjectOverview(
  args: Record<string, unknown>,
): Promise<unknown> {
  const ck = `overview:${JSON.stringify(args ?? {})}`;
  const hit = overviewCache.get(ck);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.data;

  // 1. lista os workflows (1 chamada)
  const wfResp = (await rawGet("/openui/tools/workflows?per_page=100")) as Record<
    string,
    unknown
  >;
  const d = (wfResp?.data ?? wfResp) as Record<string, unknown>;
  const rawList = (d?.rows ?? d?.workflows ?? d?.data ?? (Array.isArray(d) ? d : [])) as Array<
    Record<string, unknown>
  >;
  const workflows = (Array.isArray(rawList) ? rawList : [])
    .map((w) => ({ id: num(w.id), name: String(w.name ?? w.title ?? `Workflow ${w.id}`) }))
    .filter((w) => w.id > 0);

  // 2. statistics/overview por workflow, no máx. 3 em paralelo (evita 429)
  const rows: OverviewRow[] = (
    await mapLimit(workflows, 3, async (w) => {
      const ov = (await rawGet(`/workflows/${w.id}/statistics/overview`)) as Record<
        string,
        unknown
      >;
      const o = (ov?.data ?? ov) as Record<string, unknown>;
      const byStatus = (o?.by_status ?? {}) as Record<string, unknown>;
      const total = num(byStatus.total ?? o.total ?? o.tasks_count);
      return { id: w.id, name: w.name, overdue: num(o.overdue_tasks), total };
    })
  ).filter(Boolean);

  const totals = {
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    workflows: rows.length,
  };
  const result = { totals, rows: rows.sort((a, b) => b.overdue - a.overdue) };
  overviewCache.set(ck, { at: Date.now(), data: result });
  return result;
}

/** Nome do responsável de uma task (string "KC Soares" ou objeto {name}). */
function respName(t: Record<string, unknown>): string {
  const r = t.responsible;
  if (typeof r === "string") return r;
  if (r && typeof r === "object") return String((r as Record<string, unknown>).name ?? "");
  return String(t.responsible_name ?? "");
}

/**
 * Tasks de um RESPONSÁVEL em TODO o projeto. A API não tem endpoint global de
 * tasks (list_tasks exige workflow_id), então o runtime itera os workflows
 * (concorrência 3 + retry em 429) e filtra por NOME — sem o agente iterar via
 * MCP (que estourava 429 na Waves). Retorna `{ rows, count }` pro TaskList.
 */
async function aggregateTasksByResponsible(
  args: Record<string, unknown>,
): Promise<unknown> {
  const name = String(args.responsible ?? args.name ?? "").trim().toLowerCase();
  const ck = `byresp:${name}`;
  const hit = overviewCache.get(ck);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.data;

  const wfResp = (await rawGet("/openui/tools/workflows?per_page=100")) as Record<
    string,
    unknown
  >;
  const wd = (wfResp?.data ?? wfResp) as Record<string, unknown>;
  const rawList = (wd?.rows ?? wd?.workflows ?? wd?.data ?? (Array.isArray(wd) ? wd : [])) as Array<
    Record<string, unknown>
  >;
  const workflows = (Array.isArray(rawList) ? rawList : [])
    .map((w) => ({ id: num(w.id), name: String(w.name ?? w.title ?? `Workflow ${w.id}`) }))
    .filter((w) => w.id > 0);

  const perWf = await mapLimit(workflows, 3, async (w) => {
    const resp = (await rawGet(
      `/openui/tools/tasks?workflow_id=${w.id}&per_page=100`,
    )) as Record<string, unknown>;
    const d = (resp?.data ?? resp) as Record<string, unknown>;
    const rows = (d?.rows ?? d?.tasks ?? d?.data ?? []) as Array<Record<string, unknown>>;
    return (Array.isArray(rows) ? rows : []).map((t) => ({ ...t, workflow_name: w.name }));
  });

  const flat = perWf.flat();
  const filtered = name
    ? flat.filter((t) => respName(t).toLowerCase().includes(name))
    : flat;
  const result = { rows: filtered, count: filtered.length };
  overviewCache.set(ck, { at: Date.now(), data: result });
  return result;
}

let providerCache: ToolProvider | null = null;
let loading: Promise<ToolProvider> | null = null;

async function build(): Promise<ToolProvider> {
  const r = await fetch("/api/openui/spec");
  const spec = (await r.json()) as OpenUISpec;
  const map: ToolProvider = {};
  for (const tool of spec.tools ?? []) {
    if (!tool.endpoint) continue;
    map[tool.name] = (args) => callTool(tool, args ?? {});
  }
  // Tools sintéticas de agregação (não estão na spec — feitas no runtime).
  map["get_project_overview"] = (args) => aggregateProjectOverview(args ?? {});
  map["get_tasks_by_responsible"] = (args) => aggregateTasksByResponsible(args ?? {});
  return map;
}

/** Garante o toolProvider montado (idempotente). Chame no mount do ChatPage. */
export async function ensureToolProvider(): Promise<ToolProvider> {
  if (providerCache) return providerCache;
  if (!loading) {
    loading = build()
      .then((m) => {
        providerCache = m;
        return m;
      })
      .catch((e) => {
        loading = null; // permite retry
        throw e;
      });
  }
  return loading;
}

/** O toolProvider já montado (ou null se ainda carregando). */
export function getToolProvider(): ToolProvider | null {
  return providerCache;
}

/** Limpa o cache de resultados (ex.: após uma mutação que muda dados). */
export function clearToolResultCache(): void {
  resultCache.clear();
  overviewCache.clear();
}
