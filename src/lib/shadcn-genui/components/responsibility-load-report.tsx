"use client";

import { defineComponent } from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";

import { HBars } from "./report-bits";

// ─────────────────────────────────────────────────────────────────
// ResponsibilityLoadReport — Relatório de RESPONSABILIDADE E CARGA.
//
// Agrupa por responsável: total, seguras/atenção/críticas (mesma classificação
// de saúde do ScheduleHealthReport), vencendo nos próximos 7 dias, % médio de
// avanço, maior risco e observação gerencial. Recebe `data` de
// Query("get_responsibility_load", {workflow_id}). Tudo no runtime, SEM LLM.

const DAY = 864e5;
const VENCENDO_DIAS = 7;
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
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

type Health = "verde" | "amarelo" | "vermelho" | "cinza";

interface Row {
  id: number;
  title: string;
  progress?: number;
  status?: string;
  responsible?: string;
  created_at?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  done_date?: string | null;
}

// Mesma lógica de saúde do ScheduleHealthReport (done = done_date).
function health(r: Row): Health {
  const done = toDate(r.done_date) != null;
  if (done) return "verde";
  const start = toDate(r.start_date) ?? toDate(r.created_at);
  const due = toDate(r.due_date);
  if (!start || !due) return "cinza";
  const today = startOfDay(new Date());
  if (today < start) return "cinza";
  if (due.getTime() < Date.now()) return "vermelho";
  const total = Math.max(1, diffDays(start, due));
  const esperado = clamp(Math.round((diffDays(start, today) / total) * 100), 0, 100);
  const desvio = clamp(n(r.progress), 0, 100) - esperado;
  if (desvio >= 0) return "verde";
  if (desvio >= -15) return "amarelo";
  return "vermelho";
}

interface Person {
  name: string;
  total: number;
  seguras: number;
  atencao: number;
  criticas: number;
  vencendo: number;
  avg: number;
  risco: string;
  obs: string;
}

function compute(data: unknown): { people: Person[]; totalTasks: number; totalCrit: number } {
  const d = (data ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(d.rows) ? d.rows : []) as Row[];
  const today = startOfDay(new Date());
  const map = new Map<string, { rows: Row[]; sumP: number }>();
  for (const r of raw) {
    const name = (r.responsible || "").trim() || "— Sem responsável";
    if (!map.has(name)) map.set(name, { rows: [], sumP: 0 });
    const g = map.get(name)!;
    g.rows.push(r);
    g.sumP += clamp(n(r.progress), 0, 100);
  }
  let totalCrit = 0;
  const people: Person[] = [];
  for (const [name, g] of map) {
    let seguras = 0, atencao = 0, criticas = 0, vencendo = 0;
    for (const r of g.rows) {
      const h = health(r);
      if (h === "verde") seguras++;
      else if (h === "amarelo") atencao++;
      else if (h === "vermelho") criticas++;
      const due = toDate(r.due_date);
      const done = toDate(r.done_date) != null;
      if (due && !done) {
        const dd = diffDays(today, due);
        if (dd >= 0 && dd <= VENCENDO_DIAS) vencendo++;
      }
    }
    totalCrit += criticas;
    const avg = Math.round(g.sumP / g.rows.length);
    const risco =
      criticas > 0 ? `${criticas} crítica${criticas > 1 ? "s" : ""}`
      : vencendo > 0 ? `${vencendo} vencendo ≤${VENCENDO_DIAS}d`
      : atencao > 0 ? `${atencao} em atenção`
      : "—";
    const obs =
      criticas >= Math.ceil(g.rows.length / 2) && g.rows.length >= 2 ? "Carga crítica — repriorizar"
      : criticas > 0 ? "Acompanhar de perto"
      : vencendo > 0 ? "Atenção a prazos próximos"
      : "Sob controle";
    people.push({ name, total: g.rows.length, seguras, atencao, criticas, vencendo, avg, risco, obs });
  }
  people.sort((a, b) => b.criticas - a.criticas || b.total - a.total);
  return { people, totalTasks: raw.length, totalCrit };
}

const COLS = [
  "Responsável", "Total", "Seguras", "Em atenção", "Críticas",
  `Vencendo ${VENCENDO_DIAS}d`, "% médio", "Maior risco", "Observação gerencial",
];

export const ResponsibilityLoadReport = defineComponent({
  name: "ResponsibilityLoadReport",
  props: z.object({ data: z.any() }),
  description:
    "Relatório de RESPONSABILIDADE E CARGA (data-driven, sem LLM). Recebe `data` de " +
    'Query("get_responsibility_load", {workflow_id: <id>}, {rows: []}). Agrupa por ' +
    "responsável: total, seguras/atenção/críticas, vencendo em 7d, % médio, maior " +
    "risco e observação. Use para \"carga por responsável / distribuição / quem está " +
    'sobrecarregado\" de um AP. Padrão: `c = Query("get_responsibility_load", {workflow_id: 90}, {rows: []})` + `rep = ResponsibilityLoadReport(c)`.',
  component: ({ props }) => {
    const { people, totalTasks, totalCrit } = React.useMemo(() => compute(props.data), [props.data]);

    if (!people.length) {
      return (
        <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          Sem tarefas para o relatório de carga por responsável.
        </div>
      );
    }

    const top = people[0];
    const cards = [
      { label: "Responsáveis", v: people.length, cls: "border-border bg-muted/30" },
      { label: "Tarefas", v: totalTasks, cls: "border-border bg-muted/30" },
      { label: "Críticas (total)", v: totalCrit, cls: "border-rose-500/30 bg-rose-500/5" },
      { label: "Mais carregado", v: top.name.replace(/^—\s*/, "").split(" ")[0] || "—", cls: "border-amber-500/30 bg-amber-500/5", small: true },
    ];
    const exec =
      `${people.length} ${people.length === 1 ? "responsável" : "responsáveis"} em ${totalTasks} tarefas. ` +
      (totalCrit > 0
        ? `A carga de risco está concentrada em ${top.name} (${top.criticas} de ${top.total} ${top.total === 1 ? "tarefa crítica" : "críticas"}) — redistribuir ou destravar essa frente reduz o gargalo do AP.`
        : "Carga equilibrada, sem concentração crítica de risco entre os responsáveis.");

    return (
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="grid grid-cols-2 gap-2 border-b p-3 sm:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-lg border p-2.5 ${c.cls}`}>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className={`font-bold tabular-nums ${c.small ? "truncate text-sm" : "text-xl"}`}>{c.v}</div>
            </div>
          ))}
        </div>
        <div className="border-b bg-muted/20 px-3 py-2 text-xs">
          <span className="font-semibold">Leitura executiva: </span>
          {exec}
        </div>
        <HBars
          items={people.slice(0, 8).map((p) => ({
            label: p.name.replace(/^—\s*/, "Sem resp."),
            total: p.total,
            risk: p.criticas,
          }))}
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
              {people.map((p, i) => (
                <tr key={p.name} className={`border-b border-border/40 ${i % 2 ? "bg-muted/10" : ""}`}>
                  <td className={`max-w-[180px] truncate px-2.5 py-1.5 font-medium ${p.name.startsWith("—") ? "text-rose-600 dark:text-rose-400" : ""}`} title={p.name}>{p.name}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{p.total}</td>
                  <td className="px-2.5 py-1.5 tabular-nums text-emerald-600 dark:text-emerald-400">{p.seguras}</td>
                  <td className="px-2.5 py-1.5 tabular-nums text-amber-600 dark:text-amber-400">{p.atencao}</td>
                  <td className="px-2.5 py-1.5 font-semibold tabular-nums text-rose-600 dark:text-rose-400">{p.criticas}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{p.vencendo}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{p.avg}%</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{p.risco}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{p.obs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
});
