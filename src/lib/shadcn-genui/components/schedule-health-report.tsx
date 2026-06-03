"use client";

import { defineComponent } from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";

import { DistroBar } from "./report-bits";

// ─────────────────────────────────────────────────────────────────
// ScheduleHealthReport — Relatório de SAÚDE DO CRONOGRAMA (data-driven).
//
// Compara o % ESPERADO (pelo tempo decorrido) vs o % REAL (progress). Desvio em
// pontos percentuais. Cards no topo (saudáveis/atenção/críticas), leitura
// executiva automática e tabela com cores por saúde. Recebe `data` de
// Query("get_schedule_health", {workflow_id}). Tudo no runtime, SEM LLM.
//
// Lógica: tarefa dura 10d, passou 5 → esperado 50%. Real 40% → desvio -10pp.
//   verde  = aderente ou acima (desvio ≥ 0, ou concluída)
//   amarelo= abaixo mas recuperável (-15pp ≤ desvio < 0)
//   vermelho= crítico ou vencido (desvio < -15pp, ou due < hoje não concluída)
//   cinza  = não iniciado ou não mensurável (sem início/prazo)

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
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function fmt(d: Date | null): string {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}

type Health = "verde" | "amarelo" | "vermelho" | "cinza";

interface Row {
  id: number;
  title: string;
  type?: string;
  progress?: number;
  status?: string;
  created_at?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  done_date?: string | null;
  responsible?: string;
}
interface HRow {
  id: number;
  title: string;
  type: string;
  start: Date | null;
  end: Date | null;
  decorridos: number | null;
  restantes: number | null;
  esperado: number | null;
  real: number;
  desvio: number | null;
  health: Health;
  acao: string;
}

function classify(r: Row): HRow {
  const start = toDate(r.start_date) ?? toDate(r.created_at);
  const due = toDate(r.due_date);
  const doneAt = toDate(r.done_date);
  // Concluída = done_date (a "data de conclusão" real). NÃO usa status: pode
  // estar "completed" sem done_date e a plataforma a mostra como não concluída.
  // Mantém consistência com o WorkflowGantt.
  const done = doneAt != null;
  const real = clamp(n(r.progress), 0, 100);
  const today = startOfDay(new Date());
  const base = {
    id: r.id,
    title: r.title || `#${r.id}`,
    type: r.type || "—",
    start,
    end: due ?? doneAt,
  };

  if (done) {
    return { ...base, decorridos: null, restantes: null, esperado: null, real, desvio: null, health: "verde", acao: "Concluída" };
  }
  if (!start || !due) {
    return { ...base, decorridos: null, restantes: null, esperado: null, real, desvio: null, health: "cinza", acao: "Definir início e prazo" };
  }
  const decorridos = Math.max(0, diffDays(start, today));
  const restantes = diffDays(today, due);
  const total = Math.max(1, diffDays(start, due));
  if (today < start) {
    return { ...base, decorridos: 0, restantes, esperado: 0, real, desvio: real, health: "cinza", acao: "Iniciar / confirmar começo" };
  }
  const esperado = clamp(Math.round((diffDays(start, today) / total) * 100), 0, 100);
  const desvio = real - esperado;
  let health: Health;
  let acao: string;
  if (due.getTime() < Date.now()) {
    health = "vermelho";
    acao = "Vencida — repactuar/destravar";
  } else if (desvio >= 0) {
    health = "verde";
    acao = "Manter ritmo";
  } else if (desvio >= -15) {
    health = "amarelo";
    acao = "Cobrar avanço";
  } else {
    health = "vermelho";
    acao = "Crítica — acelerar";
  }
  return { ...base, decorridos, restantes, esperado, real, desvio, health, acao };
}

const H_STYLE: Record<Health, { dot: string; text: string; label: string }> = {
  verde: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", label: "Saudável" },
  amarelo: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", label: "Atenção" },
  vermelho: { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", label: "Crítica" },
  cinza: { dot: "bg-slate-400", text: "text-slate-500", label: "Não medível" },
};

function compute(data: unknown): {
  workflowId?: number;
  rows: HRow[];
  sum: Record<Health, number>;
  total: number;
  overdue: number;
} {
  const d = (data ?? {}) as Record<string, unknown>;
  const workflowId = d.workflow_id != null ? n(d.workflow_id) : undefined;
  const raw = (Array.isArray(d.rows) ? d.rows : []) as Row[];
  const rows = raw.map(classify).sort((a, b) => {
    const order: Health[] = ["vermelho", "amarelo", "cinza", "verde"];
    return order.indexOf(a.health) - order.indexOf(b.health);
  });
  const sum: Record<Health, number> = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 };
  let overdue = 0;
  for (const r of rows) {
    sum[r.health]++;
    if (r.health === "vermelho" && r.restantes != null && r.restantes < 0) overdue++;
  }
  return { workflowId, rows, sum, total: rows.length, overdue };
}

// Leitura executiva DESCRITIVA: não só conta — interpreta o padrão e aponta a
// prioridade (gerada do dado, sem LLM).
function execReading(sum: Record<Health, number>, total: number, overdue: number): string {
  if (!total) return "Sem tarefas mensuráveis no período.";
  const crit = sum.vermelho;
  const critPct = Math.round((crit / total) * 100);
  const behind = crit - overdue; // críticas que ainda não venceram, mas atrás

  let head: string;
  if (crit === 0 && sum.amarelo === 0)
    head = `Cronograma aderente: ${sum.verde} de ${total} tarefas no ritmo planejado ou à frente.`;
  else if (critPct >= 60)
    head = `Cronograma sob forte pressão — ${crit} de ${total} tarefas críticas (${critPct}%)${sum.verde === 0 ? ", nenhuma saudável" : `, só ${sum.verde} saudáveis`}.`;
  else head = `Atenção: ${crit} ${crit === 1 ? "tarefa crítica" : "críticas"} e ${sum.amarelo} em atenção de ${total}.`;

  let interp = "";
  if (crit > 0) {
    if (overdue >= crit * 0.6)
      interp =
        ` O padrão é acúmulo de itens VENCIDOS (${overdue}) com avanço real baixo — o cronograma vira registro de atraso, não instrumento de gestão. Prioridade: destravar/repactuar as vencidas por criticidade antes de reprogramar o resto.`;
    else if (behind > 0)
      interp =
        ` A maioria das críticas ainda não venceu (${behind} perigosamente atrás do esperado) — janela curta pra acelerar antes de virar atraso.`;
    else
      interp = ` ${overdue} ${overdue === 1 ? "item vencido exige" : "vencidos exigem"} ação imediata.`;
  } else if (sum.amarelo > 0) {
    interp = ` Ritmo abaixo do esperado em ${sum.amarelo} ${sum.amarelo === 1 ? "item" : "itens"}, ainda recuperável — acompanhar de perto pra não escalar.`;
  }
  if (sum.cinza > 0) interp += ` ${sum.cinza} sem medição (definir início/prazo).`;
  return head + interp;
}

const CARDS: Array<{ k: Health | "total"; label: string; cls: string }> = [
  { k: "verde", label: "Saudáveis", cls: "border-emerald-500/30 bg-emerald-500/5" },
  { k: "amarelo", label: "Em atenção", cls: "border-amber-500/30 bg-amber-500/5" },
  { k: "vermelho", label: "Críticas", cls: "border-rose-500/30 bg-rose-500/5" },
  { k: "total", label: "Total", cls: "border-border bg-muted/30" },
];

const COLS = [
  "Plano/Tarefa", "Tipo", "Início", "Fim", "Dias decorr.", "Dias rest.",
  "% esperado", "% real", "Desvio", "Saúde", "Próxima ação",
];

export const ScheduleHealthReport = defineComponent({
  name: "ScheduleHealthReport",
  props: z.object({ data: z.any() }),
  description:
    "Relatório de SAÚDE DO CRONOGRAMA (data-driven, sem LLM). Recebe `data` de " +
    'Query("get_schedule_health", {workflow_id: <id>}, {rows: []}). Compara % esperado ' +
    "(tempo decorrido) vs % real (progress), classifica saúde (verde/amarelo/vermelho/" +
    "cinza) e mostra cards + leitura executiva + tabela. Use para qualquer pedido de " +
    '"saúde do cronograma / avanço esperado vs real / desvio" de um AP. Padrão: ' +
    '`h = Query("get_schedule_health", {workflow_id: 90}, {rows: []})` + `rep = ScheduleHealthReport(h)`.',
  component: ({ props }) => {
    const { rows, sum, total, overdue } = React.useMemo(() => compute(props.data), [props.data]);

    if (!total) {
      return (
        <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          Sem tarefas para o relatório de saúde do cronograma.
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        {/* Cards de topo */}
        <div className="grid grid-cols-2 gap-2 border-b p-3 sm:grid-cols-4">
          {CARDS.map((c) => (
            <div key={c.label} className={`rounded-lg border p-2.5 ${c.cls}`}>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className="text-xl font-bold tabular-nums">
                {c.k === "total" ? total : sum[c.k]}
              </div>
            </div>
          ))}
        </div>

        {/* Leitura executiva automática */}
        <div className="border-b bg-muted/20 px-3 py-2 text-xs leading-relaxed">
          <span className="font-semibold">Leitura executiva: </span>
          {execReading(sum, total, overdue)}
        </div>

        <DistroBar
          label="Distribuição de saúde"
          segs={[
            { v: sum.verde, cls: "bg-emerald-500", label: "Saudáveis" },
            { v: sum.amarelo, cls: "bg-amber-500", label: "Em atenção" },
            { v: sum.vermelho, cls: "bg-rose-500", label: "Críticas" },
            { v: sum.cinza, cls: "bg-slate-400", label: "Sem medição" },
          ]}
        />

        {/* Tabela */}
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
              {rows.map((r, i) => {
                const hs = H_STYLE[r.health];
                const dev =
                  r.desvio == null ? "—" : `${r.desvio > 0 ? "+" : ""}${r.desvio}pp`;
                return (
                  <tr key={r.id} className={`border-b border-border/40 ${i % 2 ? "bg-muted/10" : ""}`}>
                    <td className="max-w-[220px] truncate px-2.5 py-1.5" title={r.title}>{r.title}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{r.type}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{fmt(r.start)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{fmt(r.end)}</td>
                    <td className="px-2.5 py-1.5 tabular-nums">{r.decorridos ?? "—"}</td>
                    <td className={`px-2.5 py-1.5 tabular-nums ${r.restantes != null && r.restantes < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                      {r.restantes ?? "—"}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums">{r.esperado == null ? "—" : `${r.esperado}%`}</td>
                    <td className="px-2.5 py-1.5 tabular-nums">{r.real}%</td>
                    <td className={`px-2.5 py-1.5 font-semibold tabular-nums ${hs.text}`}>{dev}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${hs.dot}`} />
                        <span className={hs.text}>{hs.label}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{r.acao}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
});
