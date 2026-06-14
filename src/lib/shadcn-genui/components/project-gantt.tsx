"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Maximize2, Minimize2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { loadWorkflowTasksFull, RateLimited } from "../../openui-tools";

// ─────────────────────────────────────────────────────────────────
// ProjectGantt — Gantt de PORTFÓLIO hierárquico (workflow → tarefa →
// subtarefa), EXPANSÍVEL. Reusa a mesma linguagem visual do WorkflowGantt
// (barra/marco/overrun/cores/atraso), mas com várias camadas e expand/collapse.
// Recebe `data` = Query("get_project_gantt", {}) → {workflows:[{id,name,tasks}]}.
// Clique numa barra/marco de tarefa/subtarefa abre o modal de edição.
// ─────────────────────────────────────────────────────────────────

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
function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const CANCEL_STATUS = /^(cancel|rejeit|arquiv|descart)/i;
type BarColor = { track: string; fill: string };
const OVERRUN_STRIPES =
  "repeating-linear-gradient(45deg, rgba(244,63,94,.55) 0 5px, rgba(244,63,94,.12) 5px 10px)";
const LEGEND: Array<{ c: string; label: string }> = [
  { c: "bg-violet-500", label: "A iniciar" },
  { c: "bg-sky-500", label: "Em andamento" },
  { c: "bg-emerald-500", label: "Concluída" },
];

interface RawTask {
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

type NodeKind = "workflow" | "task" | "milestone";
interface GNode {
  key: string;
  id: number; // task id (edita) ou workflow id
  kind: NodeKind;
  level: number;
  name: string;
  start: Date;
  end: Date;
  progress: number;
  done: boolean;
  overdue: boolean;
  canceled: boolean;
  responsible?: string;
  children: GNode[];
  empty?: boolean; // workflow sem tarefas → linha "sem tarefas" (sem barra)
  loading?: boolean; // workflow buscando agora → "carregando…"
  notLoaded?: boolean; // workflow ainda não buscado (lazy) → expansível, sem barra
}

function colorOf(t: { kind: NodeKind; canceled: boolean; done: boolean; overdue: boolean; progress: number }): BarColor {
  if (t.canceled) return { track: "bg-slate-400/15", fill: "bg-gradient-to-r from-slate-400 to-slate-300" };
  if (t.done) return { track: "bg-emerald-500/15", fill: "bg-gradient-to-r from-emerald-500 to-emerald-400" };
  // Atraso NÃO muda mais a cor da barra — vira um SINALIZADOR (⚠) à parte.
  if (t.progress > 0) return { track: "bg-sky-500/15", fill: "bg-gradient-to-r from-sky-500 to-sky-400" };
  return { track: "bg-violet-500/15", fill: "bg-gradient-to-r from-violet-500 to-violet-400" };
}

/** Mapeia uma task (root ou sub) num nó com barra/marco — mesma regra do WorkflowGantt. */
function taskNode(r: RawTask, level: number, children: GNode[]): GNode {
  const start = toDate(r.start_date) ?? new Date();
  const due = toDate(r.due_date);
  const doneAt = toDate(r.done_date);
  const done = doneAt != null;
  const canceled = CANCEL_STATUS.test(r.status ?? "");
  const end = due ?? doneAt;
  const overdue = !done && !canceled && due != null && due.getTime() < Date.now();
  let kind: NodeKind = "task";
  let e: Date;
  if (!end) {
    kind = "milestone";
    e = start;
  } else {
    e = end.getTime() < start.getTime() ? addDays(start, 1) : end;
  }
  return {
    key: `t:${r.id}`,
    id: r.id,
    kind,
    level,
    name: r.title || `#${r.id}`,
    start,
    end: e,
    progress: Math.max(0, Math.min(100, n(r.progress))),
    done,
    overdue,
    canceled,
    responsible: r.responsible,
    children,
  };
}

function buildTree(data: unknown): { roots: GNode[]; overdueCount: number } {
  const d = (data ?? {}) as Record<string, unknown>;
  const wfs = (Array.isArray(d.workflows) ? d.workflows : []) as Array<{ id: number; name: string; tasks?: RawTask[]; loaded?: boolean; loading?: boolean }>;
  let overdueCount = 0;
  const roots: GNode[] = [];
  for (const wf of wfs) {
    // Não carregado ainda (lazy) → linha expansível (clica pra buscar); se está
    // buscando → "carregando…". Sem barra em ambos.
    if (wf.loaded === false) {
      roots.push({
        key: `w:${wf.id}`, id: wf.id, kind: "workflow", level: 0, name: wf.name,
        start: new Date(), end: new Date(), progress: 0, done: false,
        overdue: false, canceled: false, children: [], empty: true,
        loading: !!wf.loading, notLoaded: !wf.loading,
      });
      continue;
    }
    const tasks = Array.isArray(wf.tasks) ? wf.tasks : [];
    const byParent = new Map<number, RawTask[]>();
    const rootTasks: RawTask[] = [];
    for (const t of tasks) {
      if (t.parent_id == null) rootTasks.push(t);
      else {
        if (!byParent.has(t.parent_id)) byParent.set(t.parent_id, []);
        byParent.get(t.parent_id)!.push(t);
      }
    }
    const taskNodes: GNode[] = rootTasks.map((rt) => {
      const subs = (byParent.get(rt.id) ?? []).map((s) => taskNode(s, 2, []));
      const node = taskNode(rt, 1, subs);
      return node;
    });
    // conta atrasadas (tasks + subtasks)
    const walk = (ns: GNode[]) => ns.forEach((x) => {
      if (x.overdue) overdueCount++;
      walk(x.children);
    });
    walk(taskNodes);
    if (!taskNodes.length) {
      // AP vazio → linha "sem tarefas" (sem barra; não entra na escala de datas).
      roots.push({
        key: `w:${wf.id}`, id: wf.id, kind: "workflow", level: 0, name: wf.name,
        start: new Date(), end: new Date(), progress: 0, done: false,
        overdue: false, canceled: false, children: [], empty: true,
      });
      continue;
    }
    // Span do workflow = min(início)/max(fim) das tarefas; estado agregado.
    let min = taskNodes[0].start;
    let max = taskNodes[0].end;
    let prog = 0;
    let allDone = true;
    let anyOverdue = false;
    const flat: GNode[] = [];
    const collect = (ns: GNode[]) => ns.forEach((x) => { flat.push(x); collect(x.children); });
    collect(taskNodes);
    for (const x of flat) {
      if (x.start < min) min = x.start;
      if (x.end > max) max = x.end;
      prog += x.progress;
      if (!x.done) allDone = false;
      if (x.overdue) anyOverdue = true;
    }
    roots.push({
      key: `w:${wf.id}`,
      id: wf.id,
      kind: "workflow",
      level: 0,
      name: wf.name,
      start: min,
      end: max,
      progress: flat.length ? Math.round(prog / flat.length) : 0,
      done: allDone,
      overdue: anyOverdue && !allDone,
      canceled: false,
      children: taskNodes,
    });
  }
  // Ordem ESTÁVEL por nome do AP (numérica: 1, 4.2, 4.4, 6.4…) — não reordena ao
  // expandir/carregar (evita as linhas pularem).
  roots.sort((a, b) => a.name.localeCompare(b.name, "pt", { numeric: true }));
  return { roots, overdueCount };
}

type View = "Semana" | "Mês" | "Ano";
const PX_PER_DAY: Record<View, number> = { Semana: 11, Mês: 4, Ano: 1.2 };
const LABEL_W = 250;
const ROW_H = 30;

function buildSegments(rangeStart: Date, rangeEnd: Date, view: View, pxPerDay: number) {
  const segs: Array<{ label: string; left: number; width: number }> = [];
  let cur = startOfDay(rangeStart);
  let guard = 0;
  while (cur < rangeEnd && guard++ < 4000) {
    let next: Date;
    let label: string;
    if (view === "Ano") {
      next = new Date(cur.getFullYear() + 1, 0, 1); // 1 coluna por ano
      label = String(cur.getFullYear());
    } else if (view === "Mês") {
      next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      label = cur.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    } else {
      label = `${String(cur.getDate()).padStart(2, "0")}/${String(cur.getMonth() + 1).padStart(2, "0")}`;
      next = addDays(cur, 7);
    }
    const left = diffDays(rangeStart, cur) * pxPerDay;
    const width = diffDays(cur, next > rangeEnd ? rangeEnd : next) * pxPerDay;
    if (width > 0) segs.push({ label, left, width });
    cur = next;
  }
  return segs;
}

export const ProjectGantt = defineComponent({
  name: "ProjectGantt",
  props: z.object({ data: z.any() }),
  description:
    "Gantt de PORTFÓLIO hierárquico (workflow → tarefa → subtarefa), EXPANSÍVEL (fluxo EXECUTE, sem LLM). " +
    'Recebe `data` de Query("get_project_gantt", {}, {workflows: []}). Cada workflow vira uma barra; clicar no chevron expande as tarefas, e cada tarefa expande as subtarefas — com as mesmas barras/cores/atraso do cronograma de um AP. ' +
    'Use para "cronograma geral", "Gantt do projeto", "Gantt de todos os APs". Padrão: `pg = Query("get_project_gantt", {}, {workflows: []})` e `g = ProjectGantt(pg)`.',
  component: ({ props }) => {
    // LAZY: a Query traz só a LISTA. As tasks de um workflow são buscadas SÓ ao
    // EXPANDIR (1 chamada por vez, sob demanda) — zero avalanche. Cache 5min.
    const wfList = React.useMemo(() => {
      const d = (props.data ?? {}) as Record<string, unknown>;
      const arr = (Array.isArray(d.workflows) ? d.workflows : []) as Array<{ id: number; name: string }>;
      return arr.map((w) => ({ id: Number(w.id), name: String(w.name) })).filter((w) => w.id > 0);
    }, [props.data]);
    const [tasksByWf, setTasksByWf] = React.useState<Map<number, RawTask[]>>(() => new Map());
    const [loadingSet, setLoadingSet] = React.useState<Set<number>>(() => new Set());

    const listKey = wfList.map((w) => w.id).join(",");

    // Busca as tasks de UM workflow. Marca "carregando", busca, grava. THROW no
    // 429 (o chamador decide retentar). loadWorkflowTasksFull já cacheia 5min.
    const loadWfAsync = React.useCallback(async (wid: number) => {
      setLoadingSet((prev) => (prev.has(wid) ? prev : new Set(prev).add(wid)));
      try {
        const rows = (await loadWorkflowTasksFull(wid)) as RawTask[];
        setTasksByWf((prev) => new Map(prev).set(wid, rows));
      } finally {
        setLoadingSet((prev) => {
          const n = new Set(prev);
          n.delete(wid);
          return n;
        });
      }
    }, []);
    // Expandir = prioridade (busca já, fire-and-forget).
    const loadWf = React.useCallback((wid: number) => void loadWfAsync(wid).catch(() => {}), [loadWfAsync]);

    // Carregamento AUTOMÁTICO ESTRITAMENTE SEQUENCIAL: chama um, ESPERA a
    // resposta, só então chama o próximo (1 em voo por vez) → barras preenchem
    // sozinhas sem martelar. No 429: espera (Retry-After) e retenta o mesmo.
    React.useEffect(() => {
      let cancelled = false;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      (async () => {
        for (const w of wfList) {
          if (cancelled) return;
          for (let tries = 0; tries < 6 && !cancelled; tries++) {
            try {
              await loadWfAsync(w.id); // cache torna no-op se já veio pelo expand
              break;
            } catch (e) {
              if (e instanceof RateLimited) await sleep(Math.max(800, e.retryAfter));
              else break; // erro não-429 → pula este workflow
            }
          }
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey]);

    const assembled = React.useMemo(
      () => ({
        workflows: wfList.map((w) => ({
          id: w.id,
          name: w.name,
          tasks: tasksByWf.get(w.id) ?? [],
          loaded: tasksByWf.has(w.id),
          loading: loadingSet.has(w.id),
        })),
      }),
      [wfList, tasksByWf, loadingSet],
    );
    const { roots, overdueCount } = React.useMemo(() => buildTree(assembled), [assembled]);

    const [view, setView] = React.useState<View>("Mês");
    const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
    const [full, setFull] = React.useState(false);
    const [year, setYear] = React.useState<number | "all">("all");
    const [onlyWithTasks, setOnlyWithTasks] = React.useState(false);

    // Em fullscreen, o modal cobre só o CONTEÚDO (à direita do sidebar): mede o
    // .openui-shell-thread-container e segue quando o sidebar abre/fecha.
    const [fsRect, setFsRect] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);
    React.useEffect(() => {
      if (!full) {
        setFsRect(null);
        return;
      }
      const el = document.querySelector(".openui-shell-thread-container") as HTMLElement | null;
      if (!el) return; // sem container → cai no fallback de viewport (inset)
      const measure = () => {
        const r = el.getBoundingClientRect();
        setFsRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [full]);

    // Anos disponíveis (dos workflows com tarefas já carregados).
    const years = React.useMemo(() => {
      const s = new Set<number>();
      for (const r of roots) {
        if (r.empty) continue;
        for (let y = r.start.getFullYear(); y <= r.end.getFullYear(); y++) s.add(y);
      }
      return Array.from(s).sort((a, b) => a - b);
    }, [roots]);
    // Se o ano filtrado deixou de existir nos dados, volta pra "todos".
    React.useEffect(() => {
      if (year !== "all" && years.length && !years.includes(year)) setYear("all");
    }, [years, year]);
    // ESC fecha o modal.
    React.useEffect(() => {
      if (!full) return;
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [full]);

    const toggle = (key: string) => {
      // Ao expandir um workflow ainda não carregado → busca as tasks dele (1 chamada).
      if (key.startsWith("w:")) {
        const wid = Number(key.slice(2));
        if (!expanded.has(key) && !tasksByWf.has(wid)) loadWf(wid);
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });
    };
    const openTask = (id: number) =>
      window.dispatchEvent(new CustomEvent("waves:edit-task", { detail: { taskId: id } }));

    // Linhas visíveis (flatten respeitando expand + filtro "só com tarefas").
    const visible = React.useMemo(() => {
      // Filtro: esconde workflows JÁ CARREGADOS e vazios (mantém os que ainda
      // carregam, pois podem ter tarefas).
      const top = onlyWithTasks
        ? roots.filter((r) => !(r.kind === "workflow" && r.empty && !r.loading && !r.notLoaded))
        : roots;
      const out: GNode[] = [];
      const walk = (ns: GNode[]) => {
        for (const x of ns) {
          out.push(x);
          if (x.children.length && expanded.has(x.key)) walk(x.children);
        }
      };
      walk(top);
      return out;
    }, [roots, expanded, onlyWithTasks]);

    const layout = React.useMemo(() => {
      // Escala de datas só dos workflows COM tarefas (vazios/carregando não têm span).
      const dated = roots.filter((r) => !r.empty);
      const pad = view === "Ano" ? 30 : view === "Mês" ? 10 : 4;
      const today = startOfDay(new Date());
      let min: Date;
      let max: Date;
      if (dated.length) {
        min = dated[0].start;
        max = dated[0].end;
        for (const r of dated) {
          if (r.start < min) min = r.start;
          if (r.end > max) max = r.end;
        }
      } else {
        // Ainda carregando / só vazios → range placeholder em torno de hoje.
        min = addDays(today, -30);
        max = addDays(today, 90);
      }
      if (today > max) max = today;
      let rangeStart = addDays(startOfDay(min), -pad);
      let rangeEnd = addDays(startOfDay(max), pad + 1);
      // Filtro de ANO: trava a janela em 01/jan–31/dez do ano escolhido.
      if (year !== "all") {
        rangeStart = new Date(year, 0, 1);
        rangeEnd = new Date(year, 11, 31);
      }
      const pxPerDay = PX_PER_DAY[view];
      const totalDays = Math.max(1, diffDays(rangeStart, rangeEnd));
      const trackW = totalDays * pxPerDay;
      const segs = buildSegments(rangeStart, rangeEnd, view, pxPerDay);
      const todayLeft = today >= rangeStart && today <= rangeEnd ? diffDays(rangeStart, today) * pxPerDay : null;
      return { rangeStart, pxPerDay, trackW, segs, todayLeft, today };
    }, [roots, view, year]);

    if (!roots.length || !layout) {
      return (
        <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
          {wfList.length ? "Carregando workflows do projeto…" : "Sem workflows para exibir no cronograma do projeto."}
        </div>
      );
    }
    const { rangeStart, pxPerDay, trackW, segs, todayLeft, today } = layout;
    const bands = todayLeft != null ? <div className="absolute top-0 z-[1] h-full w-px bg-red-500/70" style={{ left: todayLeft }} /> : null;

    const FS_INSET = 10;
    const fullStyle = fsRect
      ? { left: fsRect.left + FS_INSET, top: fsRect.top + FS_INSET, width: Math.max(0, fsRect.width - 2 * FS_INSET), height: Math.max(0, fsRect.height - 2 * FS_INSET) }
      : undefined;
    const card = (
      <div
        className={full
          ? `fixed z-[1001] flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl${fsRect ? "" : " inset-3"}`
          : "overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"}
        style={full ? fullStyle : undefined}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-foreground/80">
            <span className="font-medium text-foreground">Cronograma do projeto</span>
            {tasksByWf.size < wfList.length ? (
              <span className="inline-flex items-center gap-1.5" title={`Carregando tarefas dos workflows (${tasksByWf.size}/${wfList.length})`}>
                <span className="size-3 animate-spin rounded-full border-2 border-sky-500/30 border-t-sky-500" />
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${wfList.length ? Math.round((tasksByWf.size / wfList.length) * 100) : 0}%` }}
                  />
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-foreground">
                  {wfList.length ? Math.round((tasksByWf.size / wfList.length) * 100) : 0}%
                </span>
                <span className="text-[10px] tabular-nums text-foreground/60">({tasksByWf.size}/{wfList.length})</span>
              </span>
            ) : (
              <span className="text-[10px] text-foreground/60">{wfList.length} APs</span>
            )}
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1">
                <span className={`size-2.5 rounded-full ${l.c}`} />
                {l.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1" title="Tarefa com prazo vencido">
              <span className="font-bold text-rose-500">⚠</span>
              {overdueCount > 0 ? `Atrasada (${overdueCount})` : "Atrasada"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={String(year)}
              onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground"
              title="Filtrar por ano"
            >
              <option value="all">Todos os anos</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOnlyWithTasks((v) => !v)}
              title="Mostrar só workflows com tarefas"
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${onlyWithTasks ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-foreground/70 hover:text-foreground"}`}
            >
              Só com tarefas
            </button>
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              {(["Semana", "Mês", "Ano"] as View[]).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${view === v ? "bg-background text-foreground shadow-sm" : "text-foreground/70 hover:text-foreground"}`}>
                  {v}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setFull((f) => !f)} title={full ? "Minimizar (Esc)" : "Maximizar"}
              className="flex size-7 items-center justify-center rounded-md text-foreground/70 transition hover:bg-muted hover:text-foreground">
              {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>

        <div className={full ? "flex-1 overflow-auto" : "max-h-[70vh] overflow-auto"}>
          <div style={{ width: LABEL_W + trackW }}>
            {/* Header de datas */}
            <div className="sticky top-0 z-20 flex border-b bg-muted/20 text-[10px] font-medium text-muted-foreground">
              <div className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-muted/40 px-2 uppercase tracking-wide" style={{ width: LABEL_W, height: ROW_H }}>
                Workflow / Tarefa
              </div>
              <div className="relative" style={{ width: trackW, height: ROW_H }}>
                {bands}
                {segs.map((s, i) => (
                  <div key={i} className="absolute top-0 z-[2] flex h-full items-center border-r border-border/60 px-1.5" style={{ left: s.left, width: s.width }}>
                    {s.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Linhas (hierárquicas) */}
            {visible.map((t, idx) => {
              const left = diffDays(rangeStart, t.start) * pxPerDay;
              const barW = Math.max(6, diffDays(t.start, t.end) * pxPerDay);
              const col = colorOf(t);
              const solidEnd = left + barW;
              const isOverrun = t.kind !== "milestone" && t.overdue && todayLeft != null && todayLeft > solidEnd;
              const overrunW = isOverrun ? todayLeft! - solidEnd : 0;
              const overrunDays = isOverrun ? diffDays(t.end, today) : 0;
              const isLoading = !!t.loading;
              const isNotLoaded = !!t.notLoaded;
              const canExpand = t.children.length > 0 || isNotLoaded; // não-carregado = clica pra buscar
              const isOpen = expanded.has(t.key);
              const isWf = t.kind === "workflow";
              const isEmpty = !!t.empty;
              const barH = isWf ? "h-4" : "h-3.5";
              return (
                <div key={t.key} className={`flex border-b border-border/40 ${isWf ? "bg-muted/30" : idx % 2 ? "bg-muted/10" : ""}`} style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r bg-card px-1 text-left text-xs" style={{ width: LABEL_W, paddingLeft: 6 + t.level * 14 }}>
                    {canExpand ? (
                      <button type="button" onClick={() => toggle(t.key)} className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted/60" title={isOpen ? "Recolher" : "Expandir"}>
                        <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                      </button>
                    ) : (
                      <span className="inline-block w-4 shrink-0" />
                    )}
                    {t.kind === "milestone" ? (
                      <span className="size-2 shrink-0 rotate-45 rounded-[1px] bg-amber-400" />
                    ) : isEmpty ? (
                      <span className="size-2 shrink-0 rounded-full border border-muted-foreground/40" />
                    ) : (
                      <span className={`size-2 shrink-0 rounded-full ${col.fill}`} />
                    )}
                    {t.overdue && !isEmpty && (
                      <span className="shrink-0 font-bold text-rose-500" title="Atrasada (prazo vencido)">⚠</span>
                    )}
                    <button type="button" onClick={() => (isWf ? toggle(t.key) : openTask(t.id))} title={t.responsible ? `${t.name} · ${t.responsible}` : t.name}
                      className={`truncate text-left hover:text-foreground/80 ${isWf ? "font-semibold" : ""} ${isEmpty ? "text-muted-foreground" : ""}`}>
                      {t.name}
                      {isLoading ? (
                        <span className="ml-1 animate-pulse text-[10px] font-normal text-muted-foreground/70">· carregando…</span>
                      ) : isNotLoaded ? (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground/40">· na fila</span>
                      ) : isEmpty ? (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">· sem tarefas</span>
                      ) : null}
                    </button>
                  </div>
                  <div className="relative" style={{ width: trackW }}>
                    {bands}
                    {isEmpty ? null : t.kind === "milestone" ? (
                      <button type="button" onClick={() => openTask(t.id)} title={`${t.name} — sem prazo (início ${fmt(t.start)})`}
                        className="absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber-400 shadow ring-2 ring-amber-200/60 hover:bg-amber-500" style={{ left }} />
                    ) : (
                      <button type="button" onClick={() => (isWf ? toggle(t.key) : openTask(t.id))}
                        title={`${t.name} — ${fmt(t.start)} → ${fmt(t.end)} (${t.progress}%)`}
                        className={`group absolute top-1/2 ${barH} -translate-y-1/2 flex items-center overflow-hidden rounded-full shadow-sm ring-1 ring-black/5 hover:brightness-105 ${col.track}`}
                        style={{ left, width: barW }}>
                        <div className={`h-full rounded-full ${col.fill}`} style={{ width: `${Math.max(t.progress, 2)}%` }} />
                      </button>
                    )}
                    {isOverrun && (
                      <button type="button" onClick={() => openTask(t.id)} title={`${t.name} — vencida em ${fmt(t.end)} · ${overrunDays}d`}
                        className="absolute top-1/2 z-[9] flex h-3 -translate-y-1/2 items-center justify-end rounded-r-md border border-rose-400/50 pr-1"
                        style={{ left: solidEnd, width: overrunW, backgroundImage: OVERRUN_STRIPES }}>
                        {overrunW >= 24 && <span className="pointer-events-none text-[9px] font-bold leading-none text-rose-700 dark:text-rose-300">+{overrunDays}d</span>}
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
    // Fullscreen via PORTAL no document.body → escapa do contexto de empilhamento
    // do chat (senão a navbar do app cobre o topo/lateral do modal).
    if (full && typeof document !== "undefined") {
      // Backdrop cobre só a área do conteúdo (deixa o sidebar livre/usável).
      const backdropStyle = fsRect
        ? { left: fsRect.left, top: fsRect.top, width: fsRect.width, height: fsRect.height }
        : undefined;
      return createPortal(
        <>
          <div
            className={`fixed z-[1000] bg-black/40 backdrop-blur-sm${fsRect ? "" : " inset-0"}`}
            style={backdropStyle}
            onClick={() => setFull(false)}
          />
          {card}
        </>,
        document.body,
      );
    }
    return card;
  },
});
