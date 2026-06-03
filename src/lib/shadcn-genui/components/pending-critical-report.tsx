"use client";

import { defineComponent } from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";

import { DistroBar } from "./report-bits";

// ─────────────────────────────────────────────────────────────────
// PendingCriticalReport — Relatório de PENDÊNCIAS CRÍTICAS (data-driven).
//
// Surfaces só o que está travado/em risco: vencidas, sem responsável, sem prazo,
// paradas (0% iniciada) e aguardando dependência. Cards de contagem + leitura
// executiva + tabela acionável. Recebe `data` de Query("get_pending_critical",
// {workflow_id}). Concluídas e itens em dia (com progresso) são excluídos.

const DAY = 864e5;
function toDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}
function fmt(d: Date | null): string {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}

type Impacto = "Alto" | "Médio" | "Baixo";
type Kind = "vencida" | "sem_resp" | "sem_prazo" | "parada" | "dependencia";

interface Row {
  id: number;
  title: string;
  type?: string;
  progress?: number;
  status?: string;
  responsible?: string;
  assigned_to?: number | null;
  depends_on?: number | null;
  created_at?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  done_date?: string | null;
}
interface PRow {
  id: number;
  title: string;
  type: string;
  responsible: string;
  kind: Kind;
  blocker: string;
  impacto: Impacto;
  dataLimite: Date | null;
  diasAtraso: number | null;
  dep: number | null;
  acao: string;
  dono: string;
}

// Retorna a pendência crítica da task, ou null se ela está OK (em dia / concluída).
function classify(r: Row): PRow | null {
  const done = toDate(r.done_date) != null;
  if (done) return null;
  const due = toDate(r.due_date);
  const start = toDate(r.start_date) ?? toDate(r.created_at);
  const real = n(r.progress);
  const today = startOfDay(new Date());
  const resp = r.responsible || "";
  const hasResp = r.assigned_to != null || !!resp;
  const base = {
    id: r.id,
    title: r.title || `#${r.id}`,
    type: r.type || "—",
    responsible: resp || "— sem responsável",
    dataLimite: due,
    dep: r.depends_on ?? null,
  };
  const overdue = due != null && due.getTime() < Date.now();
  const diasAtraso = overdue && due ? Math.max(0, diffDays(due, today)) : null;

  if (overdue) {
    return { ...base, kind: "vencida", blocker: "Vencida", impacto: "Alto", diasAtraso,
      acao: "Repactuar prazo ou destravar", dono: resp || "Gestor do AP" };
  }
  if (!hasResp) {
    return { ...base, kind: "sem_resp", blocker: "Sem responsável", impacto: "Alto", diasAtraso: null,
      acao: "Atribuir responsável", dono: "Gestor do AP" };
  }
  if (r.depends_on != null) {
    return { ...base, kind: "dependencia", blocker: `Aguardando dependência #${r.depends_on}`, impacto: "Médio",
      diasAtraso: null, acao: "Cobrar/destravar a dependência", dono: resp };
  }
  if (real === 0 && start && today >= start) {
    return { ...base, kind: "parada", blocker: "Parada (0% iniciada)", impacto: "Médio", diasAtraso: null,
      acao: "Iniciar execução", dono: resp };
  }
  if (!due) {
    return { ...base, kind: "sem_prazo", blocker: "Sem prazo definido", impacto: "Baixo", diasAtraso: null,
      acao: "Definir prazo", dono: resp };
  }
  return null; // em andamento, no prazo → não é pendência crítica
}

const IMP_STYLE: Record<Impacto, string> = {
  Alto: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  Médio: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Baixo: "bg-slate-400/15 text-slate-600 dark:text-slate-300",
};

function compute(data: unknown): {
  rows: PRow[];
  counts: { vencida: number; sem_resp: number; sem_prazo: number; outras: number };
} {
  const d = (data ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(d.rows) ? d.rows : []) as Row[];
  const order: Impacto[] = ["Alto", "Médio", "Baixo"];
  const rows = raw
    .map(classify)
    .filter((x): x is PRow => x != null)
    .sort((a, b) => order.indexOf(a.impacto) - order.indexOf(b.impacto) || (b.diasAtraso ?? 0) - (a.diasAtraso ?? 0));
  const counts = { vencida: 0, sem_resp: 0, sem_prazo: 0, outras: 0 };
  for (const r of rows) {
    if (r.kind === "vencida") counts.vencida++;
    else if (r.kind === "sem_resp") counts.sem_resp++;
    else if (r.kind === "sem_prazo") counts.sem_prazo++;
    else counts.outras++;
  }
  return { rows, counts };
}

const COLS = [
  "Plano/Tarefa", "Tipo", "Responsável", "Bloqueio/Pendência", "Impacto",
  "Data limite", "Dias atraso", "Dependência", "Próxima ação", "Dono da ação",
];

export const PendingCriticalReport = defineComponent({
  name: "PendingCriticalReport",
  props: z.object({ data: z.any() }),
  description:
    "Relatório de PENDÊNCIAS CRÍTICAS (data-driven, sem LLM). Recebe `data` de " +
    'Query("get_pending_critical", {workflow_id: <id>}, {rows: []}). Mostra só o ' +
    "travado/em risco: vencidas, sem responsável, sem prazo, paradas (0%), " +
    "aguardando dependência — cards + leitura executiva + tabela acionável. Use " +
    'para "pendências/bloqueios/o que está travado/críticas" de um AP. Padrão: ' +
    '`p = Query("get_pending_critical", {workflow_id: 90}, {rows: []})` + `rep = PendingCriticalReport(p)`.',
  component: ({ props }) => {
    const { rows, counts } = React.useMemo(() => compute(props.data), [props.data]);

    if (!rows.length) {
      return (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          ✅ Nenhuma pendência crítica — sem itens vencidos, sem responsável, sem prazo ou parados.
        </div>
      );
    }

    const cards = [
      { label: "Vencidas", v: counts.vencida, cls: "border-rose-500/30 bg-rose-500/5" },
      { label: "Sem responsável", v: counts.sem_resp, cls: "border-rose-500/30 bg-rose-500/5" },
      { label: "Sem prazo", v: counts.sem_prazo, cls: "border-amber-500/30 bg-amber-500/5" },
      { label: "Total pendências", v: rows.length, cls: "border-border bg-muted/30" },
    ];
    const exec =
      `${rows.length} ${rows.length === 1 ? "pendência crítica" : "pendências críticas"} no AP (${counts.vencida} vencidas, ${counts.sem_resp} sem responsável, ${counts.sem_prazo} sem prazo). ` +
      (counts.vencida > 0
        ? `O peso está nas ${counts.vencida} VENCIDAS — destravar/repactuar por criticidade é o 1º passo${counts.sem_resp > 0 ? `; ${counts.sem_resp} ainda sem dono (atribuir antes de cobrar)` : ""}.`
        : counts.sem_resp > 0
          ? `Nenhuma vencida ainda, mas ${counts.sem_resp} sem responsável — sem dono não anda; atribuir destrava.`
          : `Sem vencidas — foco em definir prazos e iniciar os parados antes que virem atraso.`);

    return (
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="grid grid-cols-2 gap-2 border-b p-3 sm:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-lg border p-2.5 ${c.cls}`}>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className="text-xl font-bold tabular-nums">{c.v}</div>
            </div>
          ))}
        </div>
        <div className="border-b bg-muted/20 px-3 py-2 text-xs">
          <span className="font-semibold">Leitura executiva: </span>
          {exec}
        </div>
        <DistroBar
          label="Pendências por tipo"
          segs={[
            { v: counts.vencida, cls: "bg-rose-500", label: "Vencidas" },
            { v: counts.sem_resp, cls: "bg-orange-500", label: "Sem responsável" },
            { v: counts.outras, cls: "bg-amber-500", label: "Paradas/dependência" },
            { v: counts.sem_prazo, cls: "bg-slate-400", label: "Sem prazo" },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {COLS.map((c) => (
                  <th key={c} className="whitespace-nowrap px-2.5 py-2 font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`border-b border-border/40 ${i % 2 ? "bg-muted/10" : ""}`}>
                  <td className="max-w-[200px] truncate px-2.5 py-1.5" title={r.title}>{r.title}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{r.type}</td>
                  <td className={`whitespace-nowrap px-2.5 py-1.5 ${r.responsible.startsWith("—") ? "text-rose-600 dark:text-rose-400" : ""}`}>{r.responsible}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium">{r.blocker}</td>
                  <td className="px-2.5 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${IMP_STYLE[r.impacto]}`}>{r.impacto}</span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{fmt(r.dataLimite)}</td>
                  <td className={`px-2.5 py-1.5 tabular-nums ${r.diasAtraso ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                    {r.diasAtraso != null ? r.diasAtraso : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{r.dep != null ? `#${r.dep}` : "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{r.acao}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{r.dono}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
});
