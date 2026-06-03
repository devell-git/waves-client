"use client";

import { defineComponent } from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";

import { setKanbanCtx } from "../../kanban-context";

// ─────────────────────────────────────────────────────────────────
// WorkflowGantt — cronograma data-driven PRÓPRIO (sem libs externas).
//
// Inspirado no modelo do gantt-task-react (Task {id,name,type,start,end,
// progress}), mas escrito do zero: React 19-safe (sem defaultProps), zero
// dependências (sem MUI/emotion), estilizado com Tailwind igual ao resto do app.
//
// Recebe `data` = saída de Query("get_workflow_gantt", {workflow_id}). Regra de
// prazo faltante:
//   • com due/done → BARRA proporcional (verde se concluída);
//   • SEM prazo    → MARCO (losango) cinza ancorado no início — não inventa
//     duração. Quando o usuário preenche o "Prazo" na tarefa (modal →
//     updateTask → invalida cache → re-fetch), o marco PROMOVE a barra sozinho.
// Clique numa barra/marco abre o modal de edição (waves:edit-task).

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
function addDays(d: Date, k: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
}
function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

type GTask = {
  id: number;
  name: string;
  type: "task" | "milestone";
  start: Date;
  end: Date;
  progress: number;
  done: boolean;
  overdue: boolean;
  canceled: boolean;
  responsible?: string;
};

interface Row {
  id: number;
  title: string;
  progress?: number;
  status?: string;
  created_at?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  done_date?: string | null;
  responsible?: string;
}

function mapRows(data: unknown): { workflowId?: number; tasks: GTask[]; undated: number; overdueCount: number } {
  const d = (data ?? {}) as Record<string, unknown>;
  const workflowId = d.workflow_id != null ? n(d.workflow_id) : undefined;
  const rows = (Array.isArray(d.rows) ? d.rows : []) as Row[];
  let undated = 0;
  let overdueCount = 0;
  const tasks: GTask[] = [];
  for (const r of rows) {
    const start = toDate(r.start_date) ?? toDate(r.created_at) ?? new Date();
    const due = toDate(r.due_date);
    const doneAt = toDate(r.done_date);
    const name = r.title || `#${r.id}`;
    const status = String(r.status ?? "");
    // Concluída se TEM data de conclusão (done_date) OU status de conclusão.
    // O done_date prevalece: tarefa com "Concluído" preenchido está pronta,
    // mesmo que o status na plataforma não tenha sido atualizado.
    const done = doneAt != null || DONE_STATUS.test(status);
    const canceled = CANCEL_STATUS.test(status);
    // Fim da barra = SEMPRE o prazo (a "data final" planejada). Concluir antes
    // não encurta a barra — só pinta de verde. Se não houver prazo, cai no
    // done_date (a única data de fim que temos).
    const end = due ?? doneAt;

    if (!end) {
      undated++;
      tasks.push({
        id: r.id, name, type: "milestone", start, end: start, progress: 0,
        done, overdue: false, canceled, responsible: r.responsible,
      });
      continue;
    }
    let e = end;
    if (e.getTime() < start.getTime()) e = addDays(start, 1);
    // Atrasada (IGUAL à plataforma): o INSTANTE do prazo já passou (due_date <
    // agora), e o status não é concluído nem cancelado. Como o Waves grava o
    // prazo à meia-noite, "vence hoje" já conta como atrasada — bate com o
    // overdue_tasks do statistics.
    const overdue = !done && !canceled && due != null && due.getTime() < Date.now();
    if (overdue) overdueCount++;
    tasks.push({
      id: r.id,
      name,
      type: "task",
      start,
      end: e,
      progress: Math.max(0, Math.min(100, n(r.progress))),
      done,
      overdue,
      canceled,
      responsible: r.responsible,
    });
  }
  tasks.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { workflowId, tasks, undated, overdueCount };
}

type View = "Dia" | "Semana" | "Mês";
const PX_PER_DAY: Record<View, number> = { Dia: 34, Semana: 16, Mês: 5 };
const LABEL_W = 188;
const ROW_H = 34;

function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Critério de status ALINHADO À PLATAFORMA. O `status` vem de /tasks/{id}.
// "concluída" = só status de conclusão (NÃO done_date — a plataforma mostra
// "Concluídas: 0" mesmo com completed_at setado; "approved" ≠ concluída).
const DONE_STATUS = /^(conclu|done|complet|finish|encerr|fechad|deliver)/i;
const CANCEL_STATUS = /^(cancel|rejeit|arquiv|descart)/i;

// Paleta por STATUS (informativa). Classes literais (Tailwind JIT precisa ver
// a string inteira). Funciona em light/dark: track translúcido + fill sólido.
type BarColor = { track: string; fill: string };
// Cor da barra SÓLIDA (período planejado). O atraso NÃO pinta a barra toda de
// vermelho — vira a faixa tracejada de "extra-time" do prazo até hoje. Assim a
// tarefa atrasada continua mostrando seu estado real (em andamento / a iniciar).
function colorOf(t: GTask): BarColor {
  if (t.canceled) return { track: "bg-slate-400/15", fill: "bg-gradient-to-r from-slate-400 to-slate-300" };
  if (t.done) return { track: "bg-emerald-500/15", fill: "bg-gradient-to-r from-emerald-500 to-emerald-400" };
  // Atrasada → barra sólida VERMELHA (o trecho de extra-time além do prazo vira
  // a faixa tracejada).
  if (t.overdue) return { track: "bg-rose-500/15", fill: "bg-gradient-to-r from-rose-500 to-rose-400" };
  if (t.progress > 0) return { track: "bg-sky-500/15", fill: "bg-gradient-to-r from-sky-500 to-sky-400" };
  return { track: "bg-violet-500/15", fill: "bg-gradient-to-r from-violet-500 to-violet-400" };
}
// Listras vermelhas diagonais = "extra-time" (overrun além do prazo).
const OVERRUN_STRIPES =
  "repeating-linear-gradient(45deg, rgba(244,63,94,.55) 0 5px, rgba(244,63,94,.12) 5px 10px)";
const LEGEND: Array<{ c: string; label: string }> = [
  { c: "bg-violet-500", label: "A iniciar" },
  { c: "bg-sky-500", label: "Em andamento" },
  { c: "bg-rose-500", label: "Atrasada" },
  { c: "bg-emerald-500", label: "Concluída" },
];

// Segmentos do cabeçalho (colunas de tempo) conforme a view.
function buildSegments(rangeStart: Date, rangeEnd: Date, view: View, pxPerDay: number) {
  const segs: Array<{ label: string; left: number; width: number }> = [];
  let cur = startOfDay(rangeStart);
  let guard = 0;
  while (cur < rangeEnd && guard++ < 2000) {
    let next: Date;
    let label: string;
    if (view === "Mês") {
      next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      label = cur.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    } else if (view === "Semana") {
      label = `${String(cur.getDate()).padStart(2, "0")}/${String(cur.getMonth() + 1).padStart(2, "0")}`;
      next = addDays(cur, 7);
    } else {
      label = String(cur.getDate());
      next = addDays(cur, 1);
    }
    const left = diffDays(rangeStart, cur) * pxPerDay;
    const width = diffDays(cur, next > rangeEnd ? rangeEnd : next) * pxPerDay;
    if (width > 0) segs.push({ label, left, width });
    cur = next;
  }
  return segs;
}

export const WorkflowGantt = defineComponent({
  name: "WorkflowGantt",
  props: z.object({
    // `data` vem de Query("get_workflow_gantt", {workflow_id}). z.any() porque é
    // resultado do runtime (RuntimeRef), não literal.
    data: z.any(),
  }),
  description:
    "Cronograma (Gantt) DATA-DRIVEN de um workflow (fluxo EXECUTE, sem LLM). " +
    'Recebe `data` de Query("get_workflow_gantt", {workflow_id: <id>}, {rows: []}) ' +
    "e monta as barras sozinho (start_date→due_date; tarefa sem prazo vira marco " +
    "cinza). Use para qualquer pedido de cronograma/linha do tempo/Gantt de um AP. " +
    'Padrão: `g = Query("get_workflow_gantt", {workflow_id: 90}, {rows: []})` e ' +
    "`gantt = WorkflowGantt(g)`. NÃO monte com dados buscados à mão.",
  component: ({ props }) => {
    const { workflowId, tasks, undated, overdueCount } = React.useMemo(
      () => mapRows(props.data),
      [props.data],
    );
    const [view, setView] = React.useState<View>("Semana");

    React.useEffect(() => {
      if (workflowId != null) setKanbanCtx({ workflowId });
    }, [workflowId]);

    const layout = React.useMemo(() => {
      if (!tasks.length) return null;
      const pad = view === "Mês" ? 7 : view === "Semana" ? 3 : 1;
      const today = startOfDay(new Date());
      let min = tasks[0].start;
      let max = tasks[0].end;
      for (const t of tasks) {
        if (t.start < min) min = t.start;
        if (t.end > max) max = t.end;
      }
      // Estende até hoje pra a faixa de "extra-time" (overrun) das atrasadas caber.
      if (today > max) max = today;
      const rangeStart = addDays(startOfDay(min), -pad);
      const rangeEnd = addDays(startOfDay(max), pad + 1);
      const pxPerDay = PX_PER_DAY[view];
      const totalDays = Math.max(1, diffDays(rangeStart, rangeEnd));
      const trackW = totalDays * pxPerDay;
      const segs = buildSegments(rangeStart, rangeEnd, view, pxPerDay);
      const todayLeft =
        today >= rangeStart && today <= rangeEnd ? diffDays(rangeStart, today) * pxPerDay : null;
      // Faixas de fim de semana (só onde o dia é visível: Dia/Semana).
      const weekends: Array<{ left: number; width: number }> = [];
      if (view !== "Mês") {
        for (let i = 0; i < totalDays; i++) {
          const day = addDays(rangeStart, i);
          const dow = day.getDay();
          if (dow === 0 || dow === 6) weekends.push({ left: i * pxPerDay, width: pxPerDay });
        }
      }
      return { rangeStart, pxPerDay, trackW, segs, todayLeft, weekends, today };
    }, [tasks, view]);

    const openTask = (id: number) =>
      window.dispatchEvent(new CustomEvent("waves:edit-task", { detail: { taskId: id } }));

    if (!tasks.length || !layout) {
      return (
        <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          Sem tarefas para exibir no cronograma.
        </div>
      );
    }

    const { rangeStart, pxPerDay, trackW, segs, todayLeft, weekends, today } = layout;

    // Camadas de fundo (fim de semana + hoje), repetidas no header e nas linhas.
    const bands = (
      <>
        {weekends.map((w, i) => (
          <div key={`we${i}`} className="absolute top-0 z-0 h-full bg-muted/40" style={{ left: w.left, width: w.width }} />
        ))}
        {todayLeft != null && (
          <div className="absolute top-0 z-[1] h-full w-px bg-red-500/70" style={{ left: todayLeft }} />
        )}
      </>
    );

    return (
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        {/* Cabeçalho: legenda + seletor de view */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1">
                <span className={`size-2.5 rounded-full ${l.c}`} />
                {l.label === "Atrasada" && overdueCount > 0 ? `Atrasada (${overdueCount})` : l.label}
              </span>
            ))}
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-4 rounded-sm" style={{ backgroundImage: OVERRUN_STRIPES }} />
                tempo extra
              </span>
            )}
            {undated > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rotate-45 rounded-[2px] bg-amber-400" />
                Sem prazo ({undated})
              </span>
            )}
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-0.5">
            {(["Dia", "Semana", "Mês"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === v
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ width: LABEL_W + trackW }}>
            {/* Linha de tempo (header de datas) */}
            <div className="flex border-b bg-muted/20 text-[10px] font-medium text-muted-foreground">
              <div
                className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted/40 px-2 uppercase tracking-wide"
                style={{ width: LABEL_W, height: ROW_H }}
              >
                Tarefa
              </div>
              <div className="relative" style={{ width: trackW, height: ROW_H }}>
                {bands}
                {segs.map((s, i) => (
                  <div
                    key={i}
                    className="absolute top-0 z-[2] flex h-full items-center border-r border-border/60 px-1.5"
                    style={{ left: s.left, width: s.width }}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Linhas das tarefas */}
            {tasks.map((t, idx) => {
              const left = diffDays(rangeStart, t.start) * pxPerDay;
              const barW = Math.max(8, diffDays(t.start, t.end) * pxPerDay);
              const col = colorOf(t);
              const showPct = t.type === "task" && barW >= 34;
              // Extra-time (overrun): do prazo (t.end) até hoje, p/ atrasadas.
              const solidEnd = left + barW;
              const isOverrun = t.type === "task" && t.overdue && todayLeft != null && todayLeft > solidEnd;
              const overrunW = isOverrun ? todayLeft! - solidEnd : 0;
              const overrunDays = isOverrun ? diffDays(t.end, today) : 0;
              return (
                <div
                  key={t.id}
                  className={`flex border-b border-border/40 ${idx % 2 ? "bg-muted/10" : ""}`}
                  style={{ height: ROW_H }}
                >
                  <button
                    type="button"
                    onClick={() => openTask(t.id)}
                    title={t.responsible ? `${t.name} · ${t.responsible}` : t.name}
                    className="sticky left-0 z-30 flex shrink-0 items-center gap-1.5 truncate border-r bg-card px-2 text-left text-xs hover:bg-muted/40"
                    style={{ width: LABEL_W }}
                  >
                    {t.type === "milestone" ? (
                      <span className="size-2 shrink-0 rotate-45 rounded-[1px] bg-amber-400" />
                    ) : (
                      <span className={`size-2 shrink-0 rounded-full ${col.fill}`} />
                    )}
                    <span className="truncate">{t.name}</span>
                  </button>
                  <div className="relative" style={{ width: trackW }}>
                    {bands}
                    {t.type === "milestone" ? (
                      <button
                        type="button"
                        onClick={() => openTask(t.id)}
                        title={`${t.name} — sem prazo (início ${fmt(t.start)})`}
                        className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber-400 shadow ring-2 ring-amber-200/60 transition hover:bg-amber-500"
                        style={{ left }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => openTask(t.id)}
                        title={`${t.name} — ${fmt(t.start)} → ${fmt(t.end)} (${t.progress}%)`}
                        className={`group absolute top-1/2 z-10 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-full shadow-sm ring-1 ring-black/5 transition hover:brightness-105 ${col.track}`}
                        style={{ left, width: barW }}
                      >
                        <div
                          className={`h-full rounded-full ${col.fill}`}
                          style={{ width: `${Math.max(t.progress, 2)}%` }}
                        />
                        {showPct && (
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-foreground/70">
                            {t.progress}%
                          </span>
                        )}
                      </button>
                    )}
                    {/* Extra-time: faixa tracejada do prazo até hoje (atrasadas) */}
                    {isOverrun && (
                      <button
                        type="button"
                        onClick={() => openTask(t.id)}
                        title={`${t.name} — vencida em ${fmt(t.end)} · ${overrunDays}d de atraso`}
                        className="absolute top-1/2 z-[9] flex h-3.5 -translate-y-1/2 items-center justify-end rounded-r-md border border-rose-400/50 pr-1"
                        style={{ left: solidEnd, width: overrunW, backgroundImage: OVERRUN_STRIPES }}
                      >
                        {overrunW >= 26 && (
                          <span className="pointer-events-none text-[9px] font-bold leading-none text-rose-700 dark:text-rose-300">
                            +{overrunDays}d
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
});
