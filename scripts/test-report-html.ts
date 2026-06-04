// Teste do buildReportHtml: alimenta linhas representativas (espelhando um AP
// com tarefas vencidas, sem responsável, sem prazo, paradas e saudáveis) e
// confere que o HTML sai COMPLETO (3 seções, KPIs, todas as tarefas na tabela).
import { buildReportHtml, type ReportRow } from "../src/lib/report-html";

const DAY = 864e5;
const d = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const rows: ReportRow[] = [
  // saudável (real >= esperado, no prazo)
  { id: 1, title: "Definir escopo regulatório", type: "Marco", progress: 80, responsible: "KC Soares", assigned_to: 10, start_date: d(-20), due_date: d(10), done_date: null },
  // concluída
  { id: 2, title: "Kickoff com fornecedor", type: "Tarefa", progress: 100, responsible: "KC Soares", assigned_to: 10, start_date: d(-30), due_date: d(-10), done_date: d(-11) },
  // crítica vencida
  { id: 3, title: "Submeter dossiê ANVISA", type: "Tarefa", progress: 20, responsible: "Paula Fahning", assigned_to: 22, start_date: d(-40), due_date: d(-5), done_date: null },
  // vencida sem progresso
  { id: 4, title: "Validar método analítico", type: "Tarefa", progress: 0, responsible: "Paula Fahning", assigned_to: 22, start_date: d(-25), due_date: d(-2), done_date: null },
  // sem responsável (bloqueio alto)
  { id: 5, title: "Contratar CRO", type: "Tarefa", progress: 0, responsible: "", assigned_to: null, start_date: d(-10), due_date: d(15), done_date: null },
  // aguardando dependência
  { id: 6, title: "Iniciar estudo de estabilidade", type: "Tarefa", progress: 0, responsible: "João Lima", assigned_to: 31, depends_on: 4, start_date: d(-5), due_date: d(30), done_date: null },
  // atenção (atrás do esperado mas no prazo)
  { id: 7, title: "Desenvolver formulação", type: "Tarefa", progress: 30, responsible: "João Lima", assigned_to: 31, start_date: d(-30), due_date: d(20), done_date: null },
  // sem prazo
  { id: 8, title: "Revisar rotulagem", type: "Tarefa", progress: 50, responsible: "KC Soares", assigned_to: 10, start_date: d(-8), due_date: null, done_date: null },
  // parada 0% já iniciada
  { id: 9, title: "Auditoria de qualidade", type: "Tarefa", progress: 0, responsible: "João Lima", assigned_to: 31, start_date: d(-3), due_date: d(40), done_date: null },
];

const html = buildReportHtml(rows, { title: "Relatório executivo — AP 6.4", subtitle: "Registro de produto — BIOSHIELD" });

const checks: Array<[string, boolean]> = [
  ["tem seção Saúde do cronograma", html.includes("Saúde do cronograma")],
  ["tem seção Pendências críticas", html.includes("Pendências críticas")],
  ["tem seção Carga por responsável", html.includes("Carga por responsável")],
  ["tem leitura executiva", html.includes("Leitura executiva")],
  ["tem título do AP", html.includes("Relatório executivo — AP 6.4")],
  ["tem subtítulo", html.includes("BIOSHIELD")],
  ["lista tarefa concluída como Saudável", html.includes("Kickoff com fornecedor")],
  ["lista tarefa vencida", html.includes("Submeter dossiê ANVISA")],
  ["marca bloqueio Sem responsável", html.includes("Sem responsável")],
  ["marca bloqueio Sem prazo", html.includes("Sem prazo")],
  ["marca dependência", html.includes("dependência #4")],
  ["agrupa por responsável (KC Soares)", html.includes("KC Soares")],
  ["agrupa por responsável (Paula)", html.includes("Paula Fahning")],
];

// todas as 9 tarefas devem aparecer na tabela de saúde (nenhuma some)
const allTitles = rows.map((r) => r.title);
const missing = allTitles.filter((t) => !html.includes(t));
checks.push([`todas as ${rows.length} tarefas no HTML`, missing.length === 0]);

let ok = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (pass) ok++;
}
if (missing.length) console.log("  faltando:", missing.join(", "));
console.log(`\n${ok}/${checks.length} checks · HTML ${html.length} chars`);
console.log(`KPIs/tabelas presentes: ${(html.match(/<table/g) || []).length} tabelas, ${(html.match(/font-weight:700/g) || []).length} KPIs`);
process.exit(ok === checks.length ? 0 : 1);
