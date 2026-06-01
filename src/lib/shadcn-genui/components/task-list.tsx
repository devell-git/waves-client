"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// TaskList — lista de tasks DATA-DRIVEN (fluxo EXECUTE, sem LLM).
//
// Recebe `data` = saída de Query("list_tasks", {workflow_id, ...}) e renderiza
// a lista (título, responsável, etapa, prazo, progresso) com clique→editar.
// O agente NÃO chama list_tasks via tool — emite Query + TaskList e o RUNTIME
// busca (client-side, fora da sessão do Hermes).

function pick(o: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}
function asNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function fmtDate(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
}

interface Row {
  id?: number;
  title: string;
  responsibleName?: string;
  stageName?: string;
  dueDate?: string;
  progress?: number;
  overdue?: boolean;
}

function mapRow(t: Record<string, unknown>): Row {
  const resp = (pick(t, ["responsible"]) as Record<string, unknown>) || {};
  const stage = (pick(t, ["funnel_stage", "stage"]) as Record<string, unknown>) || {};
  const itemsCount = asNum(pick(t, ["items_count"]));
  const itemsDone = asNum(pick(t, ["items_completed", "items_done"]));
  const due = pick(t, ["due_date", "due_at"]);
  const dueIso = due ? String(due).slice(0, 10) : undefined;
  return {
    id: asNum(pick(t, ["id"])),
    title: String(pick(t, ["title", "name"]) ?? "(sem título)"),
    responsibleName:
      (pick(resp, ["name"]) as string) ?? (pick(t, ["responsible_name"]) as string),
    stageName:
      (pick(stage, ["name"]) as string) ?? (pick(t, ["funnel_stage_name", "stage_name"]) as string),
    dueDate: fmtDate(due),
    progress:
      itemsCount && itemsCount > 0 && itemsDone != null
        ? Math.round((itemsDone / itemsCount) * 100)
        : asNum(pick(t, ["progress"])),
    overdue: !!(dueIso && Boolean(pick(t, ["overdue", "is_overdue"]))),
  };
}

function mapRows(data: unknown): Row[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const raw =
    (pick(d, ["rows", "tasks", "data", "items"]) as Array<Record<string, unknown>>) ||
    (Array.isArray(d) ? (d as unknown as Array<Record<string, unknown>>) : []);
  return (Array.isArray(raw) ? raw : []).map(mapRow);
}

export const TaskList = defineComponent({
  name: "TaskList",
  props: z.object({
    // `data` vem de Query("list_tasks", {...}). z.any() = resultado do runtime.
    data: z.any(),
    title: z.string().optional(),
  }),
  description:
    "Lista de tasks DATA-DRIVEN (fluxo EXECUTE, sem LLM). Recebe `data` de " +
    'Query("list_tasks", {workflow_id: <id>, funnel_stage_id?, responsible_id?, search?}, {rows: []}) ' +
    "e renderiza a lista (título, responsável, etapa, prazo, progresso) com clique→editar. " +
    "Use SEMPRE este componente para listar/filtrar tasks de um workflow — NÃO chame a tool " +
    "list_tasks você mesmo. Padrão: `t = Query(\"list_tasks\", {workflow_id: 57}, {rows: []})` + " +
    "`lista = TaskList(t)`. Para filtrar por responsável/etapa, passe o filtro nos args da Query " +
    "(ex.: {workflow_id: 57, responsible_id: $resp}) — o runtime re-busca sozinho ao mudar.",
  component: ({ props }) => {
    const rows = mapRows(props.data);
    const title = props.title as string | undefined;

    if (rows.length === 0) {
      return (
        <div className="text-xs text-muted-foreground py-4 text-center">
          Nenhuma task.
        </div>
      );
    }

    return (
      <div className="rounded-md border overflow-hidden">
        {title && (
          <div className="px-3 py-2 text-sm font-semibold border-b bg-muted/40">{title}</div>
        )}
        <div className="divide-y">
          {rows.map((r, i) => (
            <div
              key={r.id ?? i}
              className={`flex items-center gap-3 px-3 py-2 text-sm ${
                r.id != null ? "cursor-pointer hover:bg-accent/50" : ""
              }`}
              onClick={
                r.id != null
                  ? () =>
                      window.dispatchEvent(
                        new CustomEvent("waves:edit-task", { detail: { taskId: r.id } }),
                      )
                  : undefined
              }
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium leading-snug truncate">{r.title}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                  {r.stageName && <span>🟢 {r.stageName}</span>}
                  {r.responsibleName && <span>👤 {r.responsibleName}</span>}
                  {r.dueDate && (
                    <span className={r.overdue ? "text-destructive font-medium" : ""}>
                      📅 {r.dueDate}
                      {r.overdue ? " (atrasada)" : ""}
                    </span>
                  )}
                  {typeof r.progress === "number" && <span>✓ {r.progress}%</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
});
