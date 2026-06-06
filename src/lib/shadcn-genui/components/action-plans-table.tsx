"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

// ActionPlansTable — lista RICA de Action Plans (fluxo EXECUTE, sem LLM).
// Recebe `data` de Query("get_action_plans", {}) e renderiza a tabela com UMA
// linha por AP. CLICAR numa linha → abre o KANBAN daquele AP (drill-down): monta
// o openui-lang do board e dispara `waves:chat-append` (o ChatPage injeta como
// mensagem nova). Determinístico — reusa get_workflow_kanban + WorkflowKanban,
// zero LLM. O agente só emite `Query("get_action_plans", {}) + ActionPlansTable`.

interface APRow {
  workflow_id: number;
  code: string;
  name: string;
  domain: string;
  responsible: string;
  progress: number;
  total: number;
  overdue: number;
}

// Escape pra string openui-lang (aspas/barra/quebra).
const escOL = (s: unknown): string =>
  String(s ?? "").replace(/[\\"]/g, "\\$&").replace(/\s*\n\s*/g, " ");

// Drill-down: monta o board do AP e injeta como mensagem nova (mesmo caminho do
// atalho de kanban — buildKanbanOpenui + waves:chat-append do ChatPage).
function openKanban(r: APRow): void {
  const sub = r.name ? escOL(r.name) : "Quadro ao vivo · arraste cards, clique pra editar";
  const openui = [
    "root = Card([header, board])",
    `header = CardHeader("Kanban — AP ${escOL(r.code)}", "${sub}")`,
    `kb = Query("get_workflow_kanban", {id: ${r.workflow_id}}, {stages: []})`,
    "board = WorkflowKanban(kb)",
  ].join("\n");
  window.dispatchEvent(new CustomEvent("waves:chat-append", { detail: { content: openui } }));
}

interface Totals { aps?: number; tasks?: number; overdue?: number; done?: number }

function mapData(data: unknown): { totals: Totals; rows: APRow[] } {
  const d = (data ?? {}) as Record<string, unknown>;
  const inner = (d.data ?? d) as Record<string, unknown>;
  const rows = (Array.isArray(inner.rows) ? inner.rows : Array.isArray(d.rows) ? d.rows : []) as APRow[];
  const totals = (inner.totals ?? d.totals ?? {}) as Totals;
  return { totals, rows };
}

const KPI = ({ v, label, danger }: { v: number | undefined; label: string; danger?: boolean }) => (
  <div className="flex flex-col">
    <span className={`text-xl font-bold ${danger && (v ?? 0) > 0 ? "text-destructive" : ""}`}>{v ?? 0}</span>
    <span className="text-[11px] text-muted-foreground">{label}</span>
  </div>
);

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="text-left px-3 py-1.5 font-medium">{children}</th>
);

export const ActionPlansTable = defineComponent({
  name: "ActionPlansTable",
  props: z.object({
    // `data` vem de Query("get_action_plans", {}).
    data: z.any(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }),
  description:
    "Lista RICA de Action Plans (fluxo EXECUTE, sem LLM). Recebe `data` de " +
    'Query("get_action_plans", {}, {totals: {}, rows: []}) — tool sintética que lista os ' +
    "workflows + statistics/overview por AP no runtime. Uma LINHA por AP (código, nome, " +
    "domínio, responsável, avanço, volume); CLICAR na linha abre o KANBAN daquele AP " +
    '(drill-down, sem LLM). Use para "Listar Action Plans"/"listar APs"/"ver todos os APs". ' +
    'Padrão: `ap = Query("get_action_plans", {}, {totals: {}, rows: []})` + `ActionPlansTable(ap)`. ' +
    "NÃO monte Table genérica pra isso nem itere os workflows você mesmo.",
  component: ({ props }) => {
    const { totals, rows } = mapData(props.data);
    const title = (props.title as string | undefined) ?? "Action Plans";
    const subtitle = props.subtitle as string | undefined;
    // Responsável vem do CONFIG do profile (não da API) → no runtime fica vazio.
    // Mostra a coluna só se ALGUMA linha tiver responsável (ex.: rows do agente).
    const hasResp = rows.some((r) => r.responsible && r.responsible.trim());

    return (
      <div className="rounded-md border overflow-hidden">
        <div className="px-3 py-2 border-b bg-muted/40">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>

        <div className="flex flex-wrap gap-4 px-3 py-3 border-b">
          <KPI v={totals.aps} label="APs" />
          <KPI v={totals.tasks} label="tasks no total" />
          <KPI v={totals.done} label="concluídos" />
          <KPI v={totals.overdue} label="atrasadas" danger />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Th>Código</Th>
                <Th>Action Plan</Th>
                <Th>Domínio</Th>
                {hasResp && <Th>Responsável</Th>}
                <Th>Avanço</Th>
                <Th>Volume</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.workflow_id}
                  className="border-b last:border-0 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => openKanban(r)}
                  title={`Abrir kanban do AP ${r.code}`}
                >
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.code}</td>
                  <td className="px-3 py-2">
                    <span className="block truncate max-w-[280px]">{r.name}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.domain || "—"}</td>
                  {hasResp && (
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.responsible || "—"}</td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap">{r.progress}%</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.total} {r.total === 1 ? "task" : "tasks"}
                    {r.overdue > 0 && <span className="text-destructive font-semibold"> · {r.overdue} atrasadas</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
          Clique numa linha para abrir o kanban do Action Plan.
        </div>
      </div>
    );
  },
});
