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
