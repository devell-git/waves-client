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

// Agente ativo (do login, casado por porta no ChatPage). Vai no header X-Agent-Id de
// TODA chamada ao proxy /api/waves; o proxy anexa ?agent_id= nas rotas de workflow/task
// (a Waves filtra quais workflows cada agente vê). Singleton de módulo (padrão setThreadGateway).
let _activeAgentId: string | null = null;
export function setActiveAgentId(id: number | string | null | undefined): void {
  _activeAgentId = id == null || id === "" ? null : String(id);
}

/** IDs dos tipos de documento (DocumentType) que o AGENTE ATIVO pode gerar.
 * Vem do login (`agent.document_type_ids`; fallback na relação `document_types`).
 * É a FONTE pra escolher o `document_type_id` ao criar documento — nada de
 * hardcode nem "pega o 1º global". `undefined` = agente sem escopo definido. */
export function getActiveAgentDocTypeIds(): number[] | undefined {
  const s = loadSession();
  const a = (s?.agents ?? []).find((x) => String(x.id) === _activeAgentId);
  if (!a) return undefined;
  const ids = Array.isArray(a.document_type_ids)
    ? a.document_type_ids
    : Array.isArray(a.document_types)
      ? a.document_types.map((d) => d?.id)
      : [];
  const clean = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return clean.length ? Array.from(new Set(clean)) : undefined;
}

function authHeaders(): Record<string, string> {
  const s = loadSession();
  const h: Record<string, string> = s?.accessToken
    ? { Authorization: `Bearer ${s.accessToken}` }
    : {};
  if (_activeAgentId) h["X-Agent-Id"] = _activeAgentId;
  return h;
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
async function rawGet(path: string, tries = 5): Promise<unknown> {
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
  // NÃO cachear resultado vazio/falho (429 engolido vira 0/0/0) — senão o falso
  // "tudo certo" persiste por todo o TTL mesmo depois do rate-limit passar.
  // Só cacheia quando carregou de verdade (há workflows e alguma task).
  if (rows.length > 0 && totals.total > 0) {
    overviewCache.set(ck, { at: Date.now(), data: result });
  }
  return result;
}

// "6.4 — Ação Precursora - Universidade/..." → {code:"6.4", domain:"Ação Precursora"}.
function parseApName(name: string): { code: string; domain: string } {
  const m = /^\s*([\d]+(?:\.[\d]+)*)\s*[—–-]\s*(.+)$/.exec(name);
  if (!m) return { code: "", domain: "" };
  const domain = m[2].split(/\s+[-–—]\s+/)[0]?.trim() ?? "";
  return { code: m[1], domain };
}

/**
 * Lista RICA de Action Plans pra `ActionPlansTable` (fluxo EXECUTE, sem LLM):
 * lista os workflows (1 call) + statistics/overview por AP (máx 3 em paralelo,
 * 429-safe) → linhas {workflow_id, code, name, domain, responsible, progress,
 * total, overdue}. Responsável vem do `creator` da listagem (sem fetch extra).
 * Cacheado. O agente só emite `Query("get_action_plans", {}) + ActionPlansTable`.
 */
async function aggregateActionPlans(args: Record<string, unknown>): Promise<unknown> {
  const ck = `aplans:${JSON.stringify(args ?? {})}`;
  const hit = overviewCache.get(ck);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.data;

  const wfResp = (await rawGet("/openui/tools/workflows?per_page=100")) as Record<string, unknown>;
  const d = (wfResp?.data ?? wfResp) as Record<string, unknown>;
  const rawList = (d?.rows ?? d?.workflows ?? d?.data ?? (Array.isArray(d) ? d : [])) as Array<
    Record<string, unknown>
  >;
  const workflows = (Array.isArray(rawList) ? rawList : [])
    .map((w) => ({ id: num(w.id), name: String(w.name ?? w.title ?? `Workflow ${w.id}`) }))
    .filter((w) => w.id > 0);

  // Por AP (máx 3 em paralelo, 429-safe): statistics/overview → volume/avanço.
  // Responsável NÃO entra no v1: a fonte é cara/incerta (creator/users dão o bot
  // "Waves") e permission-gated (detalhe 403 fora do escopo). Fica "—" por ora.
  const rows = (
    await mapLimit(workflows, 3, async (w) => {
      const ov = (await rawGet(`/workflows/${w.id}/statistics/overview`)) as Record<string, unknown>;
      const o = (ov?.data ?? ov) as Record<string, unknown>;
      const byStatus = (o?.by_status ?? {}) as Record<string, unknown>;
      const total = num(byStatus.total ?? o.total ?? o.tasks_count);
      const overdue = num(o.overdue_tasks);
      const done = num(byStatus.done ?? byStatus.completed ?? byStatus.approved ?? o.completed_tasks);
      const progress = o.progress != null ? Math.round(num(o.progress)) : total ? Math.round((done / total) * 100) : 0;
      const { code, domain } = parseApName(w.name);
      return { workflow_id: w.id, code: code || String(w.id), name: w.name, domain, responsible: "", progress, total, overdue };
    })
  ).filter(Boolean);

  rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const totals = {
    aps: rows.length,
    tasks: rows.reduce((s, r) => s + r.total, 0),
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    done: rows.filter((r) => r.total > 0 && r.progress >= 100).length,
  };
  const result = { totals, rows };
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

// ── Gantt de workflow (sintético): lista tasks + hidrata datas via detalhe ──
// As datas (start_date/due_date/done_date) NÃO vêm na listagem nem no kanban —
// só no detalhe (get_task). Então listamos as tasks (1 call) e hidratamos as
// datas por task no detalhe (máx 3 em paralelo, 429-safe). Cacheado. Tudo no
// runtime, SEM LLM. Tasks sem due/done → o componente vira marco (milestone).
const tasksCache = new Map<string, { at: number; rows: unknown[] }>();

// Tasks de um workflow com datas hidratadas (start/due/done), status, tipo e
// responsável. Lista (1 call) + detalhe por task (/tasks/{id}, máx 3 paralelo,
// 429-safe). Cacheado por workflow. Base COMPARTILHADA: Gantt, Saúde do
// cronograma e os demais relatórios consomem isto (uma hidratação só).
async function loadWorkflowTasks(wid: number): Promise<unknown[]> {
  const ck = `tasks:${wid}`;
  const hit = tasksCache.get(ck);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.rows;

  const listResp = (await rawGet(
    `/openui/tools/tasks?workflow_id=${wid}&per_page=100`,
  )) as Record<string, unknown>;
  const ld = (listResp?.data ?? listResp) as Record<string, unknown>;
  const rawList = (ld?.rows ?? ld?.tasks ?? ld?.data ?? (Array.isArray(ld) ? ld : [])) as Array<
    Record<string, unknown>
  >;
  const base = (Array.isArray(rawList) ? rawList : [])
    .map((t) => {
      const resp = t.responsible as Record<string, unknown> | string | undefined;
      const responsible =
        typeof resp === "string" ? resp : resp && typeof resp === "object" ? String(resp.name ?? "") : "";
      const tt = t.task_type as Record<string, unknown> | string | undefined;
      const type =
        typeof tt === "string" ? tt : tt && typeof tt === "object" ? String(tt.name ?? "") : "";
      return {
        id: num(t.id),
        title: String(t.title ?? t.name ?? "(sem título)"),
        progress: num(t.progress),
        created_at: (t.created_at as string) ?? null,
        responsible,
        type,
      };
    })
    .filter((t) => t.id > 0);

  const rows = await mapLimit(base, 3, async (t) => {
    try {
      // Detalhe COMPLETO (/tasks/{id}) — traz start_date/due_date/done_date.
      // O endpoint /openui/tools/tasks/show é trimado e NÃO devolve as datas.
      const dResp = (await rawGet(`/tasks/${t.id}`)) as Record<string, unknown>;
      let d = (dResp?.data ?? dResp) as Record<string, unknown>;
      d = (d?.task as Record<string, unknown>) ?? d;
      // Mantém o TIMESTAMP completo (não trunca p/ dia): o componente precisa do
      // instante pra "atrasada" bater com a plataforma (due_date < agora).
      const firstDate = (keys: string[]): string | null => {
        for (const k of keys) {
          const v = d[k];
          if (v != null && v !== "") return String(v);
        }
        return null;
      };
      const status = d.status;
      return {
        ...t,
        status: typeof status === "string" ? status : status != null ? String(status) : "",
        assigned_to: d.assigned_to != null ? num(d.assigned_to) : null,
        depends_on: d.depends_on_task_id != null ? num(d.depends_on_task_id) : null,
        start_date: firstDate(["start_date", "started_at", "started_on", "begin_date"]),
        due_date: firstDate(["due_date", "due_at"]),
        // SÓ done_date (a "data de conclusão" que a plataforma mostra). NÃO usar
        // completed_at: é outro campo (aprovação/etapa) que pode estar setado sem
        // a task estar concluída — marcava task como done indevidamente.
        done_date: firstDate(["done_date", "done_at", "finished_at"]),
      };
    } catch {
      return { ...t, status: "", assigned_to: null, depends_on: null, start_date: null, due_date: null, done_date: null };
    }
  });

  tasksCache.set(ck, { at: Date.now(), rows });
  return rows;
}

async function aggregateWorkflowGantt(args: Record<string, unknown>): Promise<unknown> {
  const wid = num(args.workflow_id ?? args.id);
  if (!wid) return { workflow_id: 0, rows: [] };
  return { workflow_id: wid, rows: await loadWorkflowTasks(wid) };
}

// ── Gantt de PORTFÓLIO (hierárquico: workflow → tarefa → subtarefa) ──────────
// Híbrido (#2): a tool devolve só a LISTA de workflows (1 chamada, rápida). O
// componente ProjectGantt chama `loadWorkflowTasksFull` por workflow EM
// BACKGROUND (concorrência) e preenche as barras conforme chegam — render
// instantâneo em vez de esperar o N+1. Cache 5min (#4) inclui os VAZIOS, então
// reaberturas pulam os 25 workflows sem tarefa.
export interface ProjectTask {
  id: number;
  title: string;
  parent_id: number | null;
  start_date: string | null;
  due_date: string | null;
  done_date: string | null;
  progress: number;
  status: string;
  responsible: string;
}
const PROJECT_TTL_MS = 600_000; // 10 min
const wfFullCache = new Map<number, { at: number; rows: ProjectTask[] }>();

// Persistência em sessionStorage → sobrevive ao RELOAD da página (o Map em
// memória não). Respeita o mesmo TTL. Por workflow (evita reescrever tudo).
const SS_PREFIX = "wfTasks:";
type CacheEntry = { at: number; rows: ProjectTask[] };
function ssGet(wid: number): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + wid);
    if (!raw) return null;
    const o = JSON.parse(raw) as CacheEntry;
    return o && typeof o.at === "number" && Array.isArray(o.rows) ? o : null;
  } catch {
    return null;
  }
}
function cacheSet(wid: number, entry: CacheEntry): void {
  wfFullCache.set(wid, entry);
  try {
    sessionStorage.setItem(SS_PREFIX + wid, JSON.stringify(entry));
  } catch {
    /* quota/sem storage → só memória */
  }
}

export class RateLimited extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super("429");
    this.retryAfter = retryAfter;
  }
}

// Gate GLOBAL: serializa as chamadas reais à Waves com um gap mínimo entre elas
// (vale pra qualquer instância/loop) — evita rajada que estoura o rate-limit.
const WAVES_MIN_GAP_MS = 600;
let wavesChain: Promise<void> = Promise.resolve();
let wavesLastAt = 0;
function wavesGate(): Promise<void> {
  const mine = wavesChain.then(async () => {
    const wait = WAVES_MIN_GAP_MS - (Date.now() - wavesLastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    wavesLastAt = Date.now();
  });
  wavesChain = mine.catch(() => {});
  return mine;
}

export async function loadWorkflowTasksFull(wid: number): Promise<ProjectTask[]> {
  let hit = wfFullCache.get(wid);
  if (!hit) {
    // Em memória vazio (ex.: depois de um reload) → tenta o sessionStorage.
    const ss = ssGet(wid);
    if (ss) {
      wfFullCache.set(wid, ss);
      hit = ss;
    }
  }
  if (hit && Date.now() - hit.at < PROJECT_TTL_MS) return hit.rows; // cache: sem rede, sem gate
  await wavesGate(); // espaça as chamadas reais
  // Fetch com status: 429 → THROW (não cacheia; o chamador retenta) — evita
  // gravar "vazio" falso quando foi só rate-limit. Só cacheia resposta real.
  const r = await fetch(`/api/waves/workflows/${wid}/tasks`, { headers: { ...authHeaders() } });
  if (r.status === 429) throw new RateLimited((Number(r.headers.get("retry-after")) || 0) * 1000);
  if (!r.ok) throw new Error(String(r.status));
  const resp = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const d = (resp?.data ?? resp) as Record<string, unknown>;
  const raw = (d?.tasks ?? d?.rows ?? d?.data ?? (Array.isArray(d) ? d : [])) as Array<Record<string, unknown>>;
  const rows: ProjectTask[] = (Array.isArray(raw) ? raw : [])
    .map((t) => {
      const au = t.assigned_user as Record<string, unknown> | undefined;
      const resp2 = t.responsible as Record<string, unknown> | string | undefined;
      const responsible =
        au && typeof au === "object"
          ? String(au.name ?? "")
          : typeof resp2 === "string"
            ? resp2
            : resp2 && typeof resp2 === "object"
              ? String(resp2.name ?? "")
              : "";
      return {
        id: num(t.id),
        title: String(t.title ?? t.name ?? "(sem título)"),
        parent_id: t.parent_id != null ? num(t.parent_id) : null,
        start_date: (t.start_date as string) ?? null,
        due_date: (t.due_date as string) ?? null,
        done_date: (t.done_date as string) ?? null,
        progress: num(t.progress),
        status: t.status != null ? String(t.status) : "",
        responsible,
      };
    })
    .filter((t) => t.id > 0);
  cacheSet(wid, { at: Date.now(), rows }); // memória + sessionStorage (sobrevive reload)
  return rows;
}

/** Gantt de portfólio: a tool devolve só a LISTA (id+name) — 1 chamada. O
 *  componente busca as tasks por workflow em background. */
async function aggregateProjectGantt(_args: Record<string, unknown>): Promise<unknown> {
  const workflows = await getWorkflowList();
  return { workflows: workflows.map((w) => ({ id: w.id, name: w.name })) };
}

// Saúde do cronograma: mesma base de tasks; o componente computa esperado×real,
// desvio e classificação. Tool = data-fetcher (compartilha cache do Gantt).
async function aggregateScheduleHealth(args: Record<string, unknown>): Promise<unknown> {
  const wid = num(args.workflow_id ?? args.id);
  if (!wid) return { workflow_id: 0, rows: [] };
  return { workflow_id: wid, rows: await loadWorkflowTasks(wid) };
}

// Pendências críticas: mesma base; o componente filtra e classifica bloqueios
// (vencida, sem responsável, sem prazo, parada, aguardando dependência).
async function aggregatePendingCritical(args: Record<string, unknown>): Promise<unknown> {
  const wid = num(args.workflow_id ?? args.id);
  if (!wid) return { workflow_id: 0, rows: [] };
  return { workflow_id: wid, rows: await loadWorkflowTasks(wid) };
}

// Carga por responsável: mesma base; o componente agrupa por pessoa e computa
// total/seguras/atenção/críticas/vencendo/% médio/risco.
async function aggregateResponsibilityLoad(args: Record<string, unknown>): Promise<unknown> {
  const wid = num(args.workflow_id ?? args.id);
  if (!wid) return { workflow_id: 0, rows: [] };
  return { workflow_id: wid, rows: await loadWorkflowTasks(wid) };
}

// ── Resolução AP→workflow_id (pro atalho determinístico de "abrir kanban") ──
// Lista de workflows (id+name). É o ponto CRÍTICO do Gantt de projeto — se ela
// falhar (429), nada aparece. Por isso: cache em memória + sessionStorage (10min,
// sobrevive reload) + gate + retry ATRAVESSANDO o 429 + fallback pro cache velho.
type WfList = Array<{ id: number; name: string }>;
const WF_LIST_TTL = 600_000; // 10 min
const WF_LIST_SS = "wfList:v1";
let wfListCache: { at: number; list: WfList } | null = null;

function ssGetWfList(): { at: number; list: WfList } | null {
  try {
    const raw = sessionStorage.getItem(WF_LIST_SS);
    if (!raw) return null;
    const o = JSON.parse(raw) as { at: number; list: WfList };
    return o && typeof o.at === "number" && Array.isArray(o.list) ? o : null;
  } catch {
    return null;
  }
}

/** Zera os caches de workflow em memória (troca de usuário/logout). O sweep de
 *  sessionStorage (user-cache) cuida do lado persistido; aqui é só o Map/var. */
export function resetWorkflowCaches(): void {
  wfFullCache.clear();
  wfListCache = null;
}

export async function getWorkflowList(): Promise<WfList> {
  if (!wfListCache) wfListCache = ssGetWfList(); // hidrata do sessionStorage (reload)
  if (wfListCache && Date.now() - wfListCache.at < WF_LIST_TTL) return wfListCache.list;

  for (let attempt = 0; attempt < 8; attempt++) {
    await wavesGate();
    let r: Response;
    try {
      r = await fetch(`/api/waves/openui/tools/workflows?per_page=100`, { headers: { ...authHeaders() } });
    } catch {
      break;
    }
    if (r.status === 429) {
      const ra = Number(r.headers.get("retry-after"));
      await new Promise((res) => setTimeout(res, ra > 0 ? ra * 1000 : Math.min(8000, 800 * 1.6 ** attempt)));
      continue; // retenta — a lista NÃO pode falhar por 429 transitório
    }
    if (!r.ok) break;
    const wfResp = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const d = (wfResp?.data ?? wfResp) as Record<string, unknown>;
    const rawList = (d?.rows ?? d?.workflows ?? d?.data ?? (Array.isArray(d) ? d : [])) as Array<Record<string, unknown>>;
    const list = (Array.isArray(rawList) ? rawList : [])
      .map((w) => ({ id: num(w.id), name: String(w.name ?? w.title ?? `Workflow ${w.id}`) }))
      .filter((w) => w.id > 0);
    if (list.length) {
      wfListCache = { at: Date.now(), list };
      try {
        sessionStorage.setItem(WF_LIST_SS, JSON.stringify(wfListCache));
      } catch {
        /* sem storage → só memória */
      }
      return list;
    }
    break; // resposta ok mas vazia → não insiste
  }
  // Falhou tudo → devolve o cache (mesmo expirado) se houver; senão vazio.
  return wfListCache?.list ?? [];
}

/**
 * Resolve um rótulo de AP (ex.: "1", "6.4") pro workflow_id numérico, casando
 * pelo número no INÍCIO do nome do workflow ("6.4 — ...") ou por "AP 6.4". Usa
 * a lista cacheada — 1 GET no máx., SEM LLM. Retorna {id, name} ou null se não
 * houver match determinístico (aí o chamador cai no fluxo normal do agente).
 */
export async function resolveWorkflowIdByLabel(
  label: string,
): Promise<{ id: number; name: string } | null> {
  const want = String(label).trim();
  if (!want) return null;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Número no início do nome, seguido de não-dígito (evita "1" casar "10"/"1.5").
  const startRe = new RegExp(`^\\s*(?:ap\\s*)?0*${esc}(?![\\d.])`, "i");
  // Ou "AP 6.4" em qualquer ponto do nome.
  const apRe = new RegExp(`\\bap\\s*0*${esc}(?![\\d.])`, "i");
  let list: Array<{ id: number; name: string }>;
  try {
    list = await getWorkflowList();
  } catch {
    return null;
  }
  return list.find((w) => startRe.test(w.name)) ?? list.find((w) => apRe.test(w.name)) ?? null;
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
  map["get_action_plans"] = (args) => aggregateActionPlans(args ?? {});
  map["get_tasks_by_responsible"] = (args) => aggregateTasksByResponsible(args ?? {});
  map["get_workflow_gantt"] = (args) => aggregateWorkflowGantt(args ?? {});
  map["get_project_gantt"] = (args) => aggregateProjectGantt(args ?? {});
  map["get_schedule_health"] = (args) => aggregateScheduleHealth(args ?? {});
  map["get_pending_critical"] = (args) => aggregatePendingCritical(args ?? {});
  map["get_responsibility_load"] = (args) => aggregateResponsibilityLoad(args ?? {});
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
