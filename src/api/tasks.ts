/**
 * Cliente do modal de edição de task (caminho B — GET ao clicar, sem LLM).
 * Usa o proxy genérico `/api/waves/<path-real-da-waves>` (server/index.ts) que
 * encaminha pra Waves com X-API-KEY (tenant) + o Bearer do usuário → a Waves
 * escopa server-side (403 fora do acesso).
 */
import { loadSession } from "../lib/session";
import { buildWorkflowsListPath, extractWorkflows } from "../../shared/workflows-list";

function authHeaders(): Record<string, string> {
  const s = loadSession();
  return s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {};
}

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
}
export interface TaskEditData {
  id: number;
  workflowId: number;
  title: string;
  funnelStageId: number | null;
  assignedTo: number | null;
  visibleToUserIds: number[];
  dueDate: string | null; // YYYY-MM-DD
  startedAt: string | null; // YYYY-MM-DD (exibição)
  completedAt: string | null; // YYYY-MM-DD (exibição)
  checklist: ChecklistItem[];
}
export interface Member {
  id: number;
  name: string;
}
export interface Stage {
  id: number;
  name: string;
}
export interface TaskType {
  id: number;
  name: string;
}

function unwrap(j: unknown, key?: string): unknown {
  const d = (j as { data?: unknown })?.data ?? j;
  if (key && d && typeof d === "object" && key in (d as Record<string, unknown>)) {
    return (d as Record<string, unknown>)[key];
  }
  return d;
}

async function get(path: string): Promise<unknown> {
  const r = await fetch(`/api/waves${path}`, { headers: authHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg =
      r.status === 403
        ? "Você não tem acesso a esta task."
        : r.status === 401
          ? "Sessão expirada — recarregue a página."
          : (body as { message?: string })?.message || `Erro ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

/** Lê a 1ª chave presente entre os candidatos (nomes variam na Waves). */
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k];
  }
  return undefined;
}
function asDate(v: unknown): string | null {
  return v != null && v !== "" ? String(v).slice(0, 10) : null;
}

/** Normaliza o checklist da task (nomes de campo variam). */
function parseChecklist(t: Record<string, unknown>): ChecklistItem[] {
  const raw = pick(t, ["checklist", "checklist_items", "subtasks", "items"]);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const o = it as Record<string, unknown>;
      const id = Number(pick(o, ["id", "item_id"]));
      const text = String(pick(o, ["text", "title", "name", "label", "description"]) ?? "");
      const done = Boolean(pick(o, ["done", "completed", "checked", "is_checked", "is_done"]));
      if (!Number.isFinite(id) && !text) return null;
      return { id: Number.isFinite(id) ? id : 0, text, done };
    })
    .filter((x): x is ChecklistItem => x != null);
}

/** Busca a task pra edição (já normalizada). */
export async function getTaskForEdit(taskId: number | string): Promise<TaskEditData> {
  const j = await get(`/tasks/${taskId}`);
  const t = unwrap(j, "task") as Record<string, unknown>;
  const vis = (t.visible_to_users as Array<{ id?: number }> | undefined) ?? [];
  const due = t.due_date as string | null | undefined;
  return {
    id: Number(t.id),
    workflowId: Number(t.workflow_id),
    title: String(t.title ?? ""),
    funnelStageId: t.funnel_stage_id != null ? Number(t.funnel_stage_id) : null,
    assignedTo: t.assigned_to != null ? Number(t.assigned_to) : null,
    visibleToUserIds: vis.map((u) => Number(u.id)).filter((n) => Number.isFinite(n)),
    dueDate: due ? String(due).slice(0, 10) : null,
    startedAt: asDate(pick(t, ["started_at", "start_date", "started_on", "begin_date"])),
    completedAt: asDate(pick(t, ["completed_at", "finished_at", "done_at", "completed_on"])),
    checklist: parseChecklist(t),
  };
}

export async function getWorkflowMembers(workflowId: number): Promise<Member[]> {
  const j = await get(`/workflows/${workflowId}/users`);
  const users = (unwrap(j, "users") as Array<{ id?: number; name?: string }>) ?? [];
  return (Array.isArray(users) ? users : [])
    .filter((u) => u?.id != null)
    .map((u) => ({ id: Number(u.id), name: String(u.name ?? `#${u.id}`) }));
}

export async function getWorkflowStages(workflowId: number): Promise<Stage[]> {
  const j = await get(`/openui/tools/workflows/stages?id=${workflowId}`);
  // a Waves devolve `{rows:[{id,name,order,funnel_id}]}` (também aceitamos
  // stages/data.stages por robustez).
  const obj = (j ?? {}) as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
  const raw = (obj.rows ?? data.rows ?? data.stages ?? obj.stages ?? []) as Array<{
    id?: number;
    name?: string;
  }>;
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => s?.id != null)
    .map((s) => ({ id: Number(s.id), name: String(s.name ?? `Etapa ${s.id}`) }));
}

/** Salva só os campos passados (PUT escopado). */
export async function updateTask(
  taskId: number,
  patch: Partial<{
    title: string;
    funnel_stage_id: number;
    assigned_to: number;
    visible_to_users: number[];
    due_date: string;
  }>,
): Promise<void> {
  const r = await fetch(`/api/waves/tasks/${taskId}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const msg =
      r.status === 403
        ? "Sem permissão pra editar esta task."
        : (body as { message?: string })?.message || `Erro ${r.status} ao salvar`;
    throw new Error(msg);
  }
}

/** Lista os workflows do usuário (pro seletor do modal de criação). */
export async function getWorkflows(): Promise<{ id: number; name: string }[]> {
  const j = await get(buildWorkflowsListPath(1, 200));
  return extractWorkflows(j)
    .filter((w) => w?.id != null)
    .map((w) => ({ id: Number(w.id), name: String(w.name ?? `Workflow ${w.id}`) }));
}

/** Lista os tipos de task do workflow. GET /workflows/:id/task-types. */
export async function getWorkflowTaskTypes(workflowId: number): Promise<TaskType[]> {
  const j = await get(`/workflows/${workflowId}/task-types`);
  const obj = (j ?? {}) as Record<string, unknown>;
  const data = (obj.data ?? obj) as Record<string, unknown>;
  const raw = (data.task_types ?? data.taskTypes ?? data.rows ?? data ?? []) as Array<{
    id?: number;
    name?: string;
  }>;
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((t) => t?.id != null)
    .map((t) => ({ id: Number(t.id), name: String(t.name ?? `Tipo ${t.id}`) }));
}

export interface CreateTaskInput {
  workflow_id: number;
  funnel_stage_id: number;
  task_type_id: number;
  title: string;
  description?: string;
  assigned_to?: number;
  start_date?: string;
  due_date?: string;
  done_date?: string;
  checklist?: string[];
  visible_to_users?: number[];
}

/** Cria uma task. POST /tasks. Retorna o id criado (quando disponível). */
export async function createTask(input: CreateTaskInput): Promise<number | null> {
  const r = await fetch(`/api/waves/tasks`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const msg =
      r.status === 403
        ? "Sem permissão pra criar tarefa neste workflow."
        : r.status === 422
          ? (b as { message?: string })?.message ||
            "Tipo de tarefa incompatível com a etapa (422)."
          : (b as { message?: string })?.message || `Erro ${r.status} ao criar`;
    throw new Error(msg);
  }
  const j = await r.json().catch(() => ({}));
  const t = unwrap(j, "task") as Record<string, unknown> | undefined;
  const id = Number(t?.id ?? (j as { id?: unknown })?.id);
  return Number.isFinite(id) ? id : null;
}

/** Move a task pra outra etapa (drag-and-drop no Kanban). POST /tasks/:id/move. */
export async function moveTask(
  taskId: number,
  funnelStageId: number,
  order?: number,
): Promise<void> {
  const body: Record<string, unknown> = { funnel_stage_id: funnelStageId };
  if (order != null) body.order = order;
  const r = await fetch(`/api/waves/tasks/${taskId}/move`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const msg =
      r.status === 403
        ? "Sem permissão pra mover esta task."
        : (b as { message?: string })?.message || `Erro ${r.status} ao mover`;
    throw new Error(msg);
  }
}

/** Marca/desmarca um item do checklist. POST /tasks/:id/checklist/toggle. */
export async function toggleChecklistItem(taskId: number, itemId: number): Promise<void> {
  const r = await fetch(`/api/waves/tasks/${taskId}/checklist/toggle`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { message?: string })?.message || `Erro ${r.status} ao atualizar item`);
  }
}
