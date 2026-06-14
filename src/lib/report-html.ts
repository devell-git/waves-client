// Gera o HTML COMPLETO do relatório executivo (saúde + pendências + carga) a
// partir das mesmas linhas que os componentes da tela usam (loadWorkflowTasks /
// get_schedule_health). Roda no RUNTIME (tem os dados) → o PDF fica FIEL à tela
// e o agente não precisa montar HTML (sem bloat). O HTML vira o `content` do
// POST /api/documents (a Waves gera o PDF).

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
function sod(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function diffDays(a: Date, b: Date): number {
  return Math.round((sod(b).getTime() - sod(a).getTime()) / DAY);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function fmt(d: Date | null): string {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export interface ReportRow {
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

type Health = "verde" | "amarelo" | "vermelho" | "cinza";

function healthOf(r: ReportRow): { h: Health; esperado: number | null; real: number; desvio: number | null; dec: number | null; rest: number | null } {
  const start = toDate(r.start_date) ?? toDate(r.created_at);
  const due = toDate(r.due_date);
  const done = toDate(r.done_date) != null;
  const real = clamp(n(r.progress), 0, 100);
  const today = sod(new Date());
  if (done) return { h: "verde", esperado: null, real, desvio: null, dec: null, rest: null };
  if (!start || !due) return { h: "cinza", esperado: null, real, desvio: null, dec: null, rest: null };
  const dec = Math.max(0, diffDays(start, today));
  const rest = diffDays(today, due);
  if (today < start) return { h: "cinza", esperado: 0, real, desvio: real, dec: 0, rest };
  const total = Math.max(1, diffDays(start, due));
  const esperado = clamp(Math.round((diffDays(start, today) / total) * 100), 0, 100);
  const desvio = real - esperado;
  let h: Health;
  if (due.getTime() < Date.now()) h = "vermelho";
  else if (desvio >= 0) h = "verde";
  else if (desvio >= -15) h = "amarelo";
  else h = "vermelho";
  return { h, esperado, real, desvio, dec, rest };
}

const HC: Record<Health, { c: string; label: string }> = {
  verde: { c: "#16a34a", label: "Saudável" },
  amarelo: { c: "#d97706", label: "Atenção" },
  vermelho: { c: "#e11d48", label: "Crítica" },
  cinza: { c: "#64748b", label: "Não medível" },
};

function card(label: string, value: string | number, color?: string): string {
  return `<div style="flex:1;min-width:110px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;${color ? `border-color:${color}55;background:${color}0d;` : ""}">
    <div style="font-size:11px;color:#6b7280">${esc(label)}</div>
    <div style="font-size:22px;font-weight:700;color:${color ?? "#111"}">${esc(value)}</div></div>`;
}
function reading(text: string): string {
  return `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5;margin:8px 0"><b>Leitura executiva:</b> ${esc(text)}</div>`;
}
function th(cols: string[]): string {
  return `<tr style="background:#f1f5f9">${cols.map((c) => `<th style="text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;color:#475569;border-bottom:1px solid #e2e8f0">${esc(c)}</th>`).join("")}</tr>`;
}
function td(v: string, style = ""): string {
  return `<td style="padding:5px 8px;font-size:11px;border-bottom:1px solid #f1f5f9;${style}">${v}</td>`;
}

// ── Seções ──
function sectionHealth(rows: ReportRow[]): string {
  const computed = rows.map((r) => ({ r, ...healthOf(r) }));
  const sum: Record<Health, number> = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 };
  let overdue = 0;
  for (const c of computed) { sum[c.h]++; if (c.h === "vermelho" && c.rest != null && c.rest < 0) overdue++; }
  computed.sort((a, b) => (["vermelho", "amarelo", "cinza", "verde"].indexOf(a.h) - ["vermelho", "amarelo", "cinza", "verde"].indexOf(b.h)));
  const total = rows.length;
  const crit = sum.vermelho, critPct = total ? Math.round((crit / total) * 100) : 0;
  let txt = crit === 0 && sum.amarelo === 0
    ? `Cronograma aderente: ${sum.verde} de ${total} no ritmo planejado.`
    : critPct >= 60
      ? `Cronograma sob forte pressão — ${crit} de ${total} críticas (${critPct}%). ${overdue >= crit * 0.6 ? `Acúmulo de VENCIDOS (${overdue}) com avanço baixo — priorizar destravar/repactuar.` : `Maioria atrás do esperado — acelerar antes de vencer.`}`
      : `${crit} críticas e ${sum.amarelo} em atenção de ${total}.`;
  if (sum.cinza) txt += ` ${sum.cinza} sem medição.`;
  const rowsHtml = computed.map(({ r, h, esperado, real, desvio, dec, rest }) => {
    const hc = HC[h];
    return `<tr>${td(esc(r.title))}${td(esc(r.type || "—"), "color:#64748b")}${td(fmt(toDate(r.start_date) ?? toDate(r.created_at)))}${td(fmt(toDate(r.due_date) ?? toDate(r.done_date)))}${td(dec != null ? String(dec) : "—")}${td(rest != null ? String(rest) : "—", rest != null && rest < 0 ? "color:#e11d48" : "")}${td(esperado == null ? "—" : esperado + "%")}${td(real + "%")}${td(desvio == null ? "—" : (desvio > 0 ? "+" : "") + desvio + "pp", `font-weight:600;color:${hc.c}`)}${td(`<span style="color:${hc.c};font-weight:600">${hc.label}</span>`)}` + `</tr>`;
  }).join("");
  return `<h2 style="font-size:15px;margin:18px 0 6px;color:#0006b3">Saúde do cronograma</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">${card("Saudáveis", sum.verde, "#16a34a")}${card("Em atenção", sum.amarelo, "#d97706")}${card("Críticas", sum.vermelho, "#e11d48")}${card("Total", total)}</div>
    ${reading(txt)}
    <table style="width:100%;border-collapse:collapse">${th(["Plano/Tarefa", "Tipo", "Início", "Fim", "Dias decorr.", "Dias rest.", "% esperado", "% real", "Desvio", "Saúde"])}${rowsHtml}</table>`;
}

function sectionPending(rows: ReportRow[]): string {
  const today = sod(new Date());
  type P = { r: ReportRow; blocker: string; impacto: string; cor: string; due: Date | null; dias: number | null; dep: number | null; acao: string; dono: string };
  const items: P[] = [];
  let venc = 0, semResp = 0, semPrazo = 0;
  for (const r of rows) {
    if (toDate(r.done_date)) continue;
    const due = toDate(r.due_date);
    const start = toDate(r.start_date) ?? toDate(r.created_at);
    const real = n(r.progress);
    const resp = r.responsible || "";
    const hasResp = r.assigned_to != null || !!resp;
    const overdue = due != null && due.getTime() < Date.now();
    let p: P | null = null;
    if (overdue) { venc++; p = { r, blocker: "Vencida", impacto: "Alto", cor: "#e11d48", due, dias: Math.max(0, diffDays(due!, today)), dep: r.depends_on ?? null, acao: "Repactuar prazo ou destravar", dono: resp || "Gestor do AP" }; }
    else if (!hasResp) { semResp++; p = { r, blocker: "Sem responsável", impacto: "Alto", cor: "#e11d48", due, dias: null, dep: r.depends_on ?? null, acao: "Atribuir responsável", dono: "Gestor do AP" }; }
    else if (r.depends_on != null) p = { r, blocker: `Aguardando dependência #${r.depends_on}`, impacto: "Médio", cor: "#d97706", due, dias: null, dep: r.depends_on, acao: "Cobrar dependência", dono: resp };
    else if (real === 0 && start && today >= start) p = { r, blocker: "Parada (0% iniciada)", impacto: "Médio", cor: "#d97706", due, dias: null, dep: null, acao: "Iniciar execução", dono: resp };
    else if (!due) { semPrazo++; p = { r, blocker: "Sem prazo definido", impacto: "Baixo", cor: "#64748b", due, dias: null, dep: null, acao: "Definir prazo", dono: resp }; }
    if (p) items.push(p);
  }
  items.sort((a, b) => ["Alto", "Médio", "Baixo"].indexOf(a.impacto) - ["Alto", "Médio", "Baixo"].indexOf(b.impacto) || (b.dias ?? 0) - (a.dias ?? 0));
  if (!items.length) return `<h2 style="font-size:15px;margin:18px 0 6px;color:#0006b3">Pendências críticas</h2><p style="color:#16a34a;font-size:12px">✓ Nenhuma pendência crítica.</p>`;
  const txt = `${items.length} pendências (${venc} vencidas, ${semResp} sem responsável, ${semPrazo} sem prazo). ${venc > 0 ? `O peso está nas ${venc} VENCIDAS — destravar/repactuar é o 1º passo.` : semResp > 0 ? `${semResp} sem dono — atribuir destrava.` : "Definir prazos e iniciar os parados."}`;
  const rowsHtml = items.map((p) => `<tr>${td(esc(p.r.title))}${td(esc(p.r.responsible || "— sem responsável"), p.r.responsible ? "" : "color:#e11d48")}${td(esc(p.blocker), "font-weight:600")}${td(`<span style="color:${p.cor};font-weight:600">${p.impacto}</span>`)}${td(fmt(p.due))}${td(p.dias != null ? String(p.dias) : "—", p.dias ? "color:#e11d48;font-weight:600" : "")}${td(p.dep != null ? "#" + p.dep : "—")}${td(esc(p.acao))}${td(esc(p.dono), "color:#64748b")}</tr>`).join("");
  return `<h2 style="font-size:15px;margin:18px 0 6px;color:#0006b3">Pendências críticas</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">${card("Vencidas", venc, "#e11d48")}${card("Sem responsável", semResp, "#e11d48")}${card("Sem prazo", semPrazo, "#d97706")}${card("Total", items.length)}</div>
    ${reading(txt)}
    <table style="width:100%;border-collapse:collapse">${th(["Plano/Tarefa", "Responsável", "Bloqueio", "Impacto", "Data limite", "Dias atraso", "Dependência", "Próxima ação", "Dono"])}${rowsHtml}</table>`;
}

function sectionLoad(rows: ReportRow[]): string {
  const map = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const name = (r.responsible || "").trim() || "— Sem responsável";
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(r);
  }
  const today = sod(new Date());
  const people = [...map.entries()].map(([name, rs]) => {
    let seg = 0, att = 0, crit = 0, venc7 = 0, sumP = 0;
    for (const r of rs) {
      const h = healthOf(r).h;
      if (h === "verde") seg++; else if (h === "amarelo") att++; else if (h === "vermelho") crit++;
      sumP += clamp(n(r.progress), 0, 100);
      const due = toDate(r.due_date);
      if (due && !toDate(r.done_date)) { const dd = diffDays(today, due); if (dd >= 0 && dd <= 7) venc7++; }
    }
    return { name, total: rs.length, seg, att, crit, venc7, avg: Math.round(sumP / rs.length) };
  }).sort((a, b) => b.crit - a.crit || b.total - a.total);
  const totalCrit = people.reduce((s, p) => s + p.crit, 0);
  const top = people[0];
  const txt = totalCrit > 0
    ? `${people.length} responsáveis em ${rows.length} tarefas. Risco concentrado em ${top.name} (${top.crit} de ${top.total} críticas) — redistribuir/destravar reduz o gargalo.`
    : `${people.length} responsáveis em ${rows.length} tarefas. Carga equilibrada.`;
  const rowsHtml = people.map((p) => `<tr>${td(esc(p.name), p.name.startsWith("—") ? "color:#e11d48;font-weight:600" : "font-weight:600")}${td(String(p.total))}${td(String(p.seg), "color:#16a34a")}${td(String(p.att), "color:#d97706")}${td(String(p.crit), "color:#e11d48;font-weight:600")}${td(String(p.venc7))}${td(p.avg + "%")}</tr>`).join("");
  return `<h2 style="font-size:15px;margin:18px 0 6px;color:#0006b3">Carga por responsável</h2>
    ${reading(txt)}
    <table style="width:100%;border-collapse:collapse">${th(["Responsável", "Total", "Seguras", "Em atenção", "Críticas", "Vencendo 7d", "% médio"])}${rowsHtml}</table>`;
}

// ════════════════════════════════════════════════════════════════════════
// RELATÓRIO EXECUTIVO DE ATUALIZAÇÃO (formato "Timbrado Bioshield")
// Reproduz EXATAMENTE o documento de referência
// (Relatorio_Executivo_AP_6_4_Atualizacao_Waves): tarefas principais,
// subtarefas, checklist principal/por subtarefa, prazos e valores.
// Fonte: GET /workflows/{id}/tasks (lista achatada raiz+sub, cada uma com
// `items` [checklist] e `children` [ids das subtarefas]).
// ════════════════════════════════════════════════════════════════════════

export interface ChecklistItem {
  description?: string | null;
  checked?: boolean;
  order?: number;
}
export interface ExecTask {
  id: number;
  title: string;
  start_date?: string | null;
  due_date?: string | null;
  parent_id?: number | null;
  order?: number;
  template_fields?: { custo_estimado?: number | null } | null;
  items?: ChecklistItem[];
  children?: Array<{ id: number }> | null;
}

const NO_COST = "Sem custo gravado (sem valor numérico no template)";

/** ISO → DD/MM/YYYY usando só a parte de data (sem deslocar fuso). */
function dmy(iso?: string | null): string {
  if (!iso) return "—";
  const s = String(iso);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
}
function custoEstimado(t: ExecTask): number | null {
  const v = t.template_fields?.custo_estimado;
  return typeof v === "number" && Number.isFinite(v) && v ? v : null;
}
function brl(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR")}`;
}
function valorOf(t: ExecTask): string {
  const v = custoEstimado(t);
  return v == null ? NO_COST : brl(v);
}
function checklist(t: ExecTask): { done: number; total: number } {
  const its = t.items ?? [];
  return { done: its.filter((i) => i.checked).length, total: its.length };
}
function checklistItemsHtml(t: ExecTask): string {
  const its = [...(t.items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!its.length) return "";
  const li = its
    .map((i) => {
      const st = i.checked ? "[Concluído]" : "[Aberto]";
      const c = i.checked ? "#16a34a" : "#64748b";
      return `<li style="font-size:11px;line-height:1.5;margin:1px 0"><span style="color:${c};font-weight:600">${st}</span> ${esc(i.description)}</li>`;
    })
    .join("");
  return `<ul style="margin:2px 0 6px 18px;padding:0">${li}</ul>`;
}

// — estilos de tabela do formato (borda visível + cabeçalho teal claro) —
const EX_TBL = "width:100%;border-collapse:collapse;margin:4px 0 8px";
const EX_TH = "text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase;color:#1e3a5f;background:#eaf2f8;border:1px solid #b9cfe0";
const EX_TD = "padding:5px 8px;font-size:11px;border:1px solid #d9e6f2;vertical-align:top";
function exTh(cols: string[]): string {
  return `<tr>${cols.map((c) => `<th style="${EX_TH}">${esc(c)}</th>`).join("")}</tr>`;
}
function exTd(v: string, style = ""): string {
  return `<td style="${EX_TD};${style}">${v}</td>`;
}
function h2(txt: string): string {
  return `<h2 style="font-size:15px;margin:18px 0 6px;color:#0f766e;border-bottom:1px solid #cbd5e1;padding-bottom:3px">${esc(txt)}</h2>`;
}

/** Bloco de UMA tarefa raiz (cabeçalho + tabela + subtarefas/checklist). */
function execTaskBlock(t: ExecTask, byId: Map<number, ExecTask>): string {
  const { done, total } = checklist(t);
  const childIds = (t.children ?? []).map((c) => c.id);
  const kids = childIds.map((id) => byId.get(id)).filter((x): x is ExecTask => !!x);
  kids.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  let html = `<h3 style="font-size:13px;margin:14px 0 4px;color:#0f172a">${esc(`${t.id} — ${t.title}`)}</h3>`;
  // Coluna "Tarefas" = itens da própria tarefa (singular quando há só 1).
  html += `<table style="${EX_TBL}">${exTh(["Início", "Fim", "Valor", total === 1 ? "Tarefa" : "Tarefas", "Subtarefas"])}`;
  html += `<tr>${exTd(dmy(t.start_date))}${exTd(dmy(t.due_date))}${exTd(esc(valorOf(t)))}${exTd(`${done}/${total}`)}${exTd(String(kids.length))}</tr></table>`;

  if (kids.length) {
    html += `<div style="font-size:12px;font-weight:600;margin:6px 0 2px">Subtarefas vinculadas:</div>`;
    html += `<table style="${EX_TBL}">${exTh(["ID", "Tarefa", "Início", "Fim", "Completadas"])}`;
    html += kids
      .map((k) => {
        const c = checklist(k);
        return `<tr>${exTd(String(k.id))}${exTd(esc(k.title))}${exTd(dmy(k.start_date))}${exTd(dmy(k.due_date))}${exTd(`${c.done}/${c.total}`)}</tr>`;
      })
      .join("");
    html += `</table>`;
    for (const k of kids) {
      const items = checklistItemsHtml(k);
      if (items) {
        html += `<div style="font-size:12px;font-weight:600;margin:6px 0 0">${esc(`Subtarefas da tarefa ${k.id} — ${k.title}`)}</div>${items}`;
      }
    }
  } else {
    const items = checklistItemsHtml(t);
    if (items) {
      const lbl = total === 1 ? "Tarefa principal:" : "Tarefas principais:";
      html += `<div style="font-size:12px;font-weight:600;margin:6px 0 0">${lbl}</div>${items}`;
    }
  }
  return html;
}

/**
 * Monta o HTML do RELATÓRIO EXECUTIVO DE ATUALIZAÇÃO a partir das tasks do
 * workflow (raiz + subtarefas), no formato/nomenclatura do documento de
 * referência. `tasks` = lista achatada de GET /workflows/{id}/tasks.
 */
export function buildExecutiveUpdateHtml(
  tasks: ExecTask[],
  opts: {
    apNumber: string | number;
    /** Nome EXATO do workflow (ex.: "6.4 — Ação Precursora - Universidade…").
     *  Quando presente, vai no título do relatório no lugar de só "AP <n>". */
    workflowName?: string;
    generatedAt?: Date;
    /** Rótulo da organização no topo (ex.: nome do cliente). OPCIONAL e vindo
     *  de fora — o builder é genérico e NÃO hardcoda cliente; o branding real
     *  do PDF já vem do DocumentType (timbrado). Omitido → linha não aparece. */
    org?: string;
    /** Estilo do relatório:
     *  - "completo" (default): cabeçalho + §1-§5 com o detalhamento das ações (§4);
     *  - "resumido": sem o §4 detalhado (só resumo/indicadores/pendências/conclusão);
     *  - "analitico": completo + a seção de Leitura analítica (`analysisHtml`). */
    mode?: "completo" | "resumido" | "analitico";
    /** §5 Conclusão executiva gerada por análise (LLM). Quando ausente, usa o
     *  texto-template determinístico. A camada de análise é OPCIONAL. */
    conclusion?: string;
    /** Bloco HTML da "Leitura analítica" (LLM) inserido no modo analítico,
     *  logo após os indicadores. Ausente → não aparece. */
    analysisHtml?: string;
  },
): string {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map(list.map((t) => [t.id, t]));
  const roots = list.filter((t) => t.parent_id == null).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const subs = list.filter((t) => t.parent_id != null);

  // Agregados (§2)
  const rootFull = roots.filter((t) => t.start_date && t.due_date).length;
  const subFull = subs.filter((t) => t.start_date && t.due_date).length;
  const rootCost = roots.filter((t) => custoEstimado(t) != null);
  const totalCost = rootCost.reduce((s, t) => s + (custoEstimado(t) ?? 0), 0);
  const totalItems = list.reduce((s, t) => s + (t.items?.length ?? 0), 0);
  const doneItems = list.reduce((s, t) => s + (t.items?.filter((i) => i.checked).length ?? 0), 0);
  const semCusto = roots.filter((t) => custoEstimado(t) == null);

  const when = opts.generatedAt ?? new Date();
  const stamp = `${when.toLocaleDateString("pt-BR")} ${when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const ap = esc(opts.apNumber);
  const mode = opts.mode ?? "completo";

  // ── Cabeçalho ──
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:900px">
    ${opts.org ? `<div style="font-size:11px;letter-spacing:1px;color:#0f766e;font-weight:700">${esc(opts.org)}</div>` : ""}
    <h1 style="font-size:19px;color:#0f172a;margin:2px 0 4px">Relatório Executivo de Atualização do AP ${opts.workflowName ? esc(opts.workflowName) : ap} na Waves</h1>
    <div style="font-size:11px;color:#475569;margin-bottom:2px">Escopo: prazos, valores, ações, e tarefas &nbsp;·&nbsp; Data do relatório: ${esc(stamp)}</div>
    <div style="font-size:11px;color:#475569;margin-bottom:8px">Confidencialidade: uso interno / executivo</div>`;

  // ── 1. Resumo executivo ──
  html += h2("1. Resumo executivo");
  html += `<ul style="margin:4px 0 4px 18px;padding:0;font-size:12px;line-height:1.6">
    <li>O AP ${ap} contém ${roots.length} ações e ${subs.length} subtarefas reais cadastradas na Waves.</li>
    <li>Após a atualização, ${rootFull} ações estão com data inicial e data final definidas; entre as subtarefas, ${subFull} de ${subs.length} estão alinhadas com as datas da ação.</li>
    <li>Foram identificadas ${totalItems} tarefas distribuídas entre ações e subtarefas, preservadas como referência operacional; ${doneItems} aparecem concluídas no ambiente atual.</li>
    <li>Os custos numéricos foram mantidos no campo custo_estimado quando compatíveis com o template; casos sem valor numérico gravado permanecem tratados como observação para preservar precisão executiva.</li>
  </ul>`;

  // ── 2. Indicadores executivos ──
  html += h2("2. Indicadores executivos");
  const ind: Array<[string, string, string, string]> = [
    ["Ações", String(roots.length), "Portfólio principal do AP " + opts.apNumber, "Ações-raiz cadastradas no workflow."],
    ["Tarefas", String(totalItems), "Desdobramentos operacionais já cadastrados", "Itens detalhados das ações e subtarefas."],
    ["Ações com prazo completo", `${rootFull}/${roots.length}`, "Cobertura de cronograma", "Data inicial e data final definidas nas ações."],
    ["Subtarefas", String(subs.length), "Desdobramentos vinculados às ações", "Alinhadas temporalmente com a ação-pai."],
    ["Subtarefas com prazo completo", `${subFull}/${subs.length}`, "Alinhamento das subtarefas existentes", "Em linha com a orientação de replicar prazos da ação-pai."],
    ["Ações com custo numérico gravado", `${rootCost.length}/${roots.length}`, "Cobertura de custos", "Exceções: ações sem valor numérico gravado no template."],
  ];
  html += `<table style="${EX_TBL}">${exTh(["Indicador", "Resultado", "Leitura executiva", "Observação"])}`;
  html += ind.map((r) => `<tr>${exTd(esc(r[0]), "font-weight:600")}${exTd(esc(r[1]))}${exTd(esc(r[2]))}${exTd(esc(r[3]), "color:#475569")}</tr>`).join("");
  html += `</table>`;

  // ── Leitura analítica (LLM) — no modo analítico (falha VISÍVEL se não vier) ──
  if (mode === "analitico") {
    html += h2("Leitura analítica");
    if (opts.analysisHtml) {
      html += `<div style="font-size:12px;line-height:1.6">${opts.analysisHtml}</div>`;
    } else {
      html += `<div style="font-size:12px;line-height:1.5;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;color:#92400e">⚠️ A leitura analítica (IA) não pôde ser gerada agora — provável limite temporário (429) da Waves. Os indicadores acima estão corretos; tente gerar a versão analítica de novo em alguns instantes.</div>`;
    }
  }

  // ── 3. Pendências e exceções tratadas ──
  html += h2("3. Pendências e exceções tratadas");
  if (semCusto.length) {
    for (const t of semCusto) {
      html += `<div style="font-size:12px;margin:6px 0"><b>Task ${t.id} — ${esc(t.title)}</b><br>No estado atual da Waves, o campo custo_estimado permanece vazio. Para evitar interpretação indevida, o valor segue sem gravação numérica até haver definição formal.</div>`;
    }
  } else {
    html += `<p style="font-size:12px;color:#16a34a">✓ Nenhuma exceção: todas as tarefas raiz têm valor numérico gravado.</p>`;
  }

  // ── 4. Tarefas e subtarefas — SÓ no modo "completo". No "resumido" e no
  // "analitico" o detalhamento das ações é omitido (analítico foca na análise;
  // resumido fica no panorama) — assim cada estilo é visivelmente diferente.
  if (mode === "completo") {
    html += h2("4. Ações, Tarefas e subtarefas com prazos, valores e checklists");
    html += roots.map((t) => execTaskBlock(t, byId)).join("");
  }

  // ── 5. Conclusão executiva (análise LLM quando disponível; senão, template) ──
  html += h2("5. Conclusão executiva");
  const conclusaoTemplate = `A atualização do AP ${ap} preserva a consistência do cronograma na Waves e mantém a rastreabilidade dos valores informados no workflow. As subtarefas reais seguem alinhadas temporalmente com suas ações-pai, e os checklists permanecem como camada operacional de execução. No recorte atual, ${rootCost.length} ações têm custo numérico gravado, somando ${brl(totalCost)}, enquanto ${semCusto.length} ${semCusto.length === 1 ? "exceção permanece" : "exceções permanecem"} sem valor numérico no template, ${semCusto.length === 1 ? "tratada" : "tratadas"} sem perda semântica para preservar a integridade executiva do dado.`;
  html += `<p style="font-size:12px;line-height:1.6">${opts.conclusion ? esc(opts.conclusion) : conclusaoTemplate}</p>`;

  html += `</div>`;
  return html;
}

// ════════════════════════════════════════════════════════════════════════
// Gráficos DETERMINÍSTICOS (CSS + SVG) pro relatório analítico — números exatos
// dos dados, renderizam na tela E no PDF (HTML→PDF). A IA escreve a narrativa
// em volta; os gráficos não dependem do modelo.
// ════════════════════════════════════════════════════════════════════════
export interface ChartSummary {
  n_tarefas: number;
  concluidas: number;
  custo_total: number;
  acoes: Array<{ id: number; titulo: string; custo: number | null; feitas: number; total_itens: number; inicio?: string }>;
}

/** Donut SVG de % (renderiza em browser e em HTML→PDF). */
function donutSvg(frac: number, label: string, color = "#16a34a"): string {
  const r = 38;
  const c = 2 * Math.PI * r;
  const dash = `${(Math.max(0, Math.min(1, frac)) * c).toFixed(1)} ${c.toFixed(1)}`;
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  return `<div style="display:inline-flex;flex-direction:column;align-items:center;gap:2px">
    <svg width="104" height="104" viewBox="0 0 104 104">
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="#e5edf3" stroke-width="13"/>
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-dasharray="${dash}" stroke-linecap="round" transform="rotate(-90 52 52)"/>
      <text x="52" y="58" text-anchor="middle" font-size="19" font-weight="700" fill="#0f172a">${pct}%</text>
    </svg>
    <div style="font-size:10px;color:#475569">${esc(label)}</div></div>`;
}

/** Pizza em SVG (embute como imagem no docx e renderiza no PDF/tela). */
function pieSvg(slices: Array<{ v: number; color: string }>, total: number): string {
  const cx = 52, cy = 52, r = 50;
  let a0 = -Math.PI / 2;
  const paths = slices
    .map((s) => {
      const frac = total ? s.v / total : 0;
      const a1 = a0 + frac * 2 * Math.PI;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      a0 = a1;
      // fatia única (100%) → círculo cheio (path de arco fecha mal em 360°).
      if (frac >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`;
      return `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${s.color}"/>`;
    })
    .join("");
  return `<svg width="104" height="104" viewBox="0 0 104 104">${paths}</svg>`;
}

/** Bloco de gráficos do relatório analítico — TODOS export-safe (SVG embute no
 *  docx; tabela vira tabela do Word). Donut de conclusão + pizza de custo +
 *  tabela de custo por ação. Tudo calculado dos dados (exato). */
export function buildAnalysisChartsHtml(s: ChartSummary): string {
  const fracDone = s.n_tarefas ? s.concluidas / s.n_tarefas : 0;
  const comCusto = s.acoes
    .filter((a) => a.custo != null && (a.custo as number) > 0)
    .sort((a, b) => (b.custo as number) - (a.custo as number));
  const total = comCusto.reduce((x, a) => x + (a.custo as number), 0) || 1;

  // Pizza: top 4 ações + "demais"
  const top4 = comCusto.slice(0, 4);
  const resto = comCusto.slice(4).reduce((x, a) => x + (a.custo as number), 0);
  const PIE = ["#0f766e", "#0ea5e9", "#f59e0b", "#e11d48", "#94a3b8"];
  const slices = [
    ...top4.map((a, i) => ({ nome: String(a.id), v: a.custo as number, color: PIE[i] })),
    ...(resto > 0 ? [{ nome: "demais", v: resto, color: PIE[4] }] : []),
  ];
  const legend = slices
    .map((sl) => `<span style="font-size:10px;color:#475569;white-space:nowrap"><span style="display:inline-block;width:9px;height:9px;background:${sl.color};margin-right:3px"></span>${esc(sl.nome)} ${Math.round((sl.v / total) * 100)}%</span>`)
    .join(" &nbsp; ");

  // Custo por ação → TABELA (export-safe: vira tabela do Word).
  const linhas = comCusto
    .slice(0, 12)
    .map(
      (a, i) =>
        `<tr><td style="padding:3px 6px;border:1px solid #d9e6f2">${i + 1}</td><td style="padding:3px 6px;border:1px solid #d9e6f2">${esc(`${a.id} — ${a.titulo}`)}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right">${esc(brl(a.custo as number))}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right">${Math.round(((a.custo as number) / total) * 100)}%</td></tr>`,
    )
    .join("");
  const tabela = comCusto.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-top:4px"><tr><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:left">#</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:left">Ação</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">Custo</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">%</th></tr>${linhas}</table>`
    : '<div style="font-size:11px;color:#64748b">Sem custos numéricos gravados.</div>';

  return `<h2 style="font-size:15px;margin:14px 0 6px;color:#0f766e;border-bottom:1px solid #cbd5e1;padding-bottom:3px">Indicadores visuais</h2>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${donutSvg(fracDone, `${s.concluidas}/${s.n_tarefas} tarefas`)}
      <div style="text-align:center">${pieSvg(slices, total)}<div style="font-size:10px;color:#475569;margin-top:2px">Custo por ação</div></div>
      <div style="flex:1;min-width:180px">${legend}</div>
    </div>
    <div style="font-size:12px;font-weight:600;margin:4px 0 2px">Custo por ação (R$)</div>
    ${tabela}`;
}

// ── Gráficos do relatório de PROJETO (todos os APs) — determinísticos ────────
export interface ProjectChartSummary {
  n_tarefas: number;
  concluidas: number;
  em_atraso: number;
  por_ap: Array<{ ap: string; nome: string; tasks: number; abertas: number; vencidas: number; concluidas: number }>;
}

/** Bloco de gráficos do relatório de projeto: donut de conclusão + donut de
 *  atraso + tabela por AP (ordenada por vencidas). Tudo dos dados (exato). */
export function buildProjectChartsHtml(s: ProjectChartSummary): string {
  const fracDone = s.n_tarefas ? s.concluidas / s.n_tarefas : 0;
  const fracAtraso = s.n_tarefas ? s.em_atraso / s.n_tarefas : 0;
  const aps = s.por_ap.filter((a) => a.tasks > 0).sort((a, b) => b.vencidas - a.vencidas || b.tasks - a.tasks);
  const linhas = aps
    .slice(0, 20)
    .map(
      (a) =>
        `<tr><td style="padding:3px 6px;border:1px solid #d9e6f2">${esc(a.nome)}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right">${a.tasks}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right">${a.abertas}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right;color:${a.vencidas > 0 ? "#e11d48" : "#475569"};font-weight:${a.vencidas > 0 ? 700 : 400}">${a.vencidas}</td><td style="padding:3px 6px;border:1px solid #d9e6f2;text-align:right;color:#15803d">${a.concluidas}</td></tr>`,
    )
    .join("");
  const tabela = aps.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-top:4px"><tr><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:left">Action Plan</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">Tasks</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">Abertas</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">Vencidas</th><th style="padding:3px 6px;border:1px solid #b9cfe0;background:#eaf2f8;text-align:right">Concluídas</th></tr>${linhas}</table>`
    : '<div style="font-size:11px;color:#64748b">Nenhum AP com tarefas.</div>';

  return `<h2 style="font-size:15px;margin:14px 0 6px;color:#0f766e;border-bottom:1px solid #cbd5e1;padding-bottom:3px">Indicadores do projeto</h2>
    <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${donutSvg(fracDone, `${s.concluidas}/${s.n_tarefas} concluídas`, "#16a34a")}
      ${donutSvg(fracAtraso, `${s.em_atraso} em atraso`, "#e11d48")}
    </div>
    <div style="font-size:12px;font-weight:600;margin:4px 0 2px">Tasks por Action Plan</div>
    ${tabela}`;
}

/** Monta o HTML executivo completo (3 seções) pra virar `content` do documento Waves. */
export function buildReportHtml(rows: ReportRow[], opts: { title: string; subtitle?: string }): string {
  const list = Array.isArray(rows) ? rows : [];
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:900px">
    <h1 style="font-size:20px;color:#0006b3;margin:0 0 2px">${esc(opts.title)}</h1>
    ${opts.subtitle ? `<div style="color:#6b7280;font-size:12px;margin-bottom:8px">${esc(opts.subtitle)}</div>` : ""}
    ${sectionHealth(list)}
    ${sectionPending(list)}
    ${sectionLoad(list)}
    <div style="margin-top:16px;color:#9ca3af;font-size:10px">Gerado pelo Waves Client a partir dos dados ao vivo do workflow.</div>
  </div>`;
}
