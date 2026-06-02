"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// ProjectOverview — visão AGREGADA do projeto (fluxo EXECUTE, sem LLM).
//
// Recebe `data` = saída de Query("get_project_overview", {}) — uma tool
// SINTÉTICA do runtime que soma `statistics/overview` de TODOS os workflows
// no navegador (sem despejar 30 tool results na sessão do Hermes). Renderiza
// KPIs (em atraso / total / nº de APs) + tabela dos APs com mais atraso.
// ─────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface Row {
  id: number;
  name: string;
  overdue: number;
  total: number;
}

function mapData(data: unknown): { overdue: number; total: number; workflows: number; rows: Row[] } {
  const d = (data ?? {}) as Record<string, unknown>;
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  const rawRows = (d.rows ?? []) as Array<Record<string, unknown>>;
  const rows: Row[] = (Array.isArray(rawRows) ? rawRows : []).map((r) => ({
    id: num(r.id),
    name: String(r.name ?? `Workflow ${r.id}`),
    overdue: num(r.overdue),
    total: num(r.total),
  }));
  return {
    overdue: num(totals.overdue),
    total: num(totals.total),
    workflows: num(totals.workflows) || rows.length,
    rows,
  };
}

export const ProjectOverview = defineComponent({
  name: "ProjectOverview",
  props: z.object({
    // `data` vem de Query("get_project_overview", {}).
    data: z.any(),
    title: z.string().optional(),
  }),
  description:
    "Visão AGREGADA do projeto (fluxo EXECUTE, sem LLM). Recebe `data` de " +
    'Query("get_project_overview", {}, {totals: {}, rows: []}) — uma tool sintética que ' +
    "soma statistics/overview de TODOS os workflows no runtime. Use para " +
    '"tasks em atraso", "status geral", "overview do projeto", "quantos em atraso" — ' +
    "NÃO itere os workflows você mesmo nem chame statistics por AP. Padrão: " +
    '`ov = Query("get_project_overview", {}, {totals: {}, rows: []})` + `ProjectOverview(ov)`.',
  component: ({ props }) => {
    const { overdue, total, workflows, rows } = mapData(props.data);
    const title = (props.title as string | undefined) ?? "Visão geral do projeto";
    const withOverdue = rows.filter((r) => r.overdue > 0).slice(0, 12);

    return (
      <div className="rounded-md border overflow-hidden">
        <div className="px-3 py-2 text-sm font-semibold border-b bg-muted/40">{title}</div>

        {/* KPIs */}
        <div className="flex flex-wrap gap-3 px-3 py-3 border-b">
          <div className="flex flex-col">
            <span className={`text-xl font-bold ${overdue > 0 ? "text-destructive" : ""}`}>
              {overdue}
            </span>
            <span className="text-[11px] text-muted-foreground">tasks em atraso</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold">{total}</span>
            <span className="text-[11px] text-muted-foreground">tasks no total</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold">{workflows}</span>
            <span className="text-[11px] text-muted-foreground">Action Plans</span>
          </div>
        </div>

        {/* APs com atraso */}
        {withOverdue.length > 0 ? (
          <div className="divide-y">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              APs com tasks em atraso
            </div>
            {withOverdue.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent/50"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("waves:open-workflow", { detail: { workflowId: r.id } }),
                  )
                }
              >
                <span className="flex-1 min-w-0 truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.total} tasks</span>
                <span className="text-destructive font-semibold text-xs whitespace-nowrap">
                  {r.overdue} em atraso
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Nenhuma task em atraso 🎉
          </div>
        )}
      </div>
    );
  },
});
