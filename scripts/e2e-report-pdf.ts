// E2E REAL do GenerateReportPdf contra a API (via o proxy do serviço em :3002).
// Replica EXATAMENTE o que o botão faz no runtime:
//   login → get_schedule_health(loadWorkflowTasks) → buildReportHtml →
//   GET /document-types → POST /documents → GET /documents/{id}/pdf
// Usa o buildReportHtml REAL do app (mesma função do componente).
import { buildReportHtml, type ReportRow } from "../src/lib/report-html";

const BASE = "http://localhost:3002/api/waves";
const EMAIL = process.env.E2E_EMAIL!;
const PASS = process.env.E2E_PASS!;

let TOKEN = "";
function H(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...extra };
}
async function jget(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: H() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d;
}
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function main() {
  // 1) login
  const lr = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, device_name: "e2e-report-pdf" }),
  });
  const lb = await lr.json().catch(() => ({}));
  if (!lr.ok) throw new Error(`login → ${lr.status} ${JSON.stringify(lb).slice(0, 300)}`);
  const data = lb.data ?? lb;
  TOKEN = data?.token?.access_token ?? data?.access_token;
  const userId = data?.user?.id;
  if (!TOKEN) throw new Error("login sem access_token");
  console.log(`✓ login: user#${userId} ${data?.user?.name ?? ""} · roles=${JSON.stringify(data?.roles ?? [])}`);

  // 2) achar um workflow com tasks (replica resolveWorkflowIdByLabel/getWorkflowList)
  const wf = await jget("/openui/tools/workflows?per_page=100");
  const wd = wf?.data ?? wf;
  const wlist = (wd?.rows ?? wd?.workflows ?? wd?.data ?? (Array.isArray(wd) ? wd : []))
    .map((w: any) => ({ id: num(w.id), name: String(w.name ?? w.title ?? `wf ${w.id}`) }))
    .filter((w: any) => w.id > 0);
  console.log(`✓ workflows visíveis: ${wlist.length}`);
  if (!wlist.length) throw new Error("nenhum workflow visível p/ este usuário");

  // escolhe o workflow com MAIS tasks (relatório mais representativo)
  let chosen: { id: number; name: string } | null = null;
  let base: any[] = [];
  let bestN = 0;
  for (const w of wlist) {
    const tr = await jget(`/openui/tools/tasks?workflow_id=${w.id}&per_page=100`).catch((e) => ({ __err: e.message }));
    const td = (tr as any)?.data ?? tr;
    const rows = (td as any)?.rows ?? (td as any)?.tasks ?? (td as any)?.data ?? [];
    const nrows = Array.isArray(rows) ? rows.length : 0;
    if (nrows > bestN) { bestN = nrows; chosen = w; base = rows; }
  }
  if (!chosen) throw new Error("nenhum workflow com tasks nos primeiros 8");
  console.log(`✓ workflow escolhido: #${chosen.id} "${chosen.name}" · ${base.length} tasks`);

  // 3) hidratar datas via /tasks/{id} (replica loadWorkflowTasks), máx 3 em paralelo
  const firstDate = (d: any, keys: string[]) => { for (const k of keys) { const v = d?.[k]; if (v != null && v !== "") return String(v); } return null; };
  const ids = base.map((t: any) => num(t.id)).filter(Boolean);
  const rows: ReportRow[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    const batch = await Promise.all(ids.slice(i, i + 3).map(async (id) => {
      const dr = await jget(`/tasks/${id}`).catch(() => ({}));
      let d = (dr?.data ?? dr) as any; d = d?.task ?? d;
      const resp = d.responsible; const responsible = typeof resp === "string" ? resp : resp?.name ?? "";
      const tt = d.task_type; const type = typeof tt === "string" ? tt : tt?.name ?? "";
      return {
        id, title: String(d.title ?? d.name ?? "(sem título)"), type, progress: num(d.progress),
        responsible, assigned_to: d.assigned_to != null ? num(d.assigned_to) : null,
        depends_on: d.depends_on_task_id != null ? num(d.depends_on_task_id) : null,
        created_at: d.created_at ?? null,
        start_date: firstDate(d, ["start_date", "started_at", "started_on", "begin_date"]),
        due_date: firstDate(d, ["due_date", "due_at"]),
        done_date: firstDate(d, ["done_date", "done_at", "finished_at"]),
      } as ReportRow;
    }));
    rows.push(...batch);
  }
  const withDates = rows.filter((r) => r.start_date || r.due_date || r.done_date).length;
  console.log(`✓ datas hidratadas: ${rows.length} tasks (${withDates} com alguma data)`);

  // 4) HTML real
  const html = buildReportHtml(rows, { title: `Relatório executivo — ${chosen.name}`, subtitle: "Teste e2e GenerateReportPdf" });
  console.log(`✓ HTML montado: ${html.length} chars · ${(html.match(/<table/g) || []).length} tabelas`);

  // 5) document_type_id
  const dt = await jget("/document-types");
  const dtd = dt?.data ?? dt;
  const dtlist = dtd?.document_types ?? dtd?.rows ?? dtd?.data ?? (Array.isArray(dtd) ? dtd : Array.isArray(dt) ? dt : []);
  const docTypeId = Array.isArray(dtlist) ? dtlist.find((x: any) => x?.id != null)?.id : null;
  console.log(`✓ document_type_id resolvido: ${docTypeId}`);

  // 6) POST /documents
  const body: any = { title: `[E2E] Relatório — ${chosen.name}`, content: html };
  if (docTypeId != null) body.document_type_id = docTypeId;
  if (userId != null) body.user_id = userId;
  const cr = await fetch(`${BASE}/documents`, { method: "POST", headers: H({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
  const cb = await cr.json().catch(() => ({}));
  if (!cr.ok) throw new Error(`POST /documents → ${cr.status} ${JSON.stringify(cb).slice(0, 300)}`);
  const cd = cb?.data ?? cb;
  const docId = cd?.id ?? cd?.document?.id;
  console.log(`✓ documento criado na Waves: id=${docId}`);
  if (docId == null) throw new Error("documento sem id");

  // 7) GET /documents/{id}/pdf
  const pr = await fetch(`${BASE}/documents/${docId}/pdf`, { headers: H() });
  const ct = pr.headers.get("content-type") || "";
  const buf = Buffer.from(await pr.arrayBuffer());
  if (!pr.ok) throw new Error(`GET /documents/${docId}/pdf → ${pr.status}`);
  const isPdf = ct.includes("pdf") || buf.slice(0, 4).toString() === "%PDF";
  console.log(`✓ PDF baixado: ${pr.status} · ${ct} · ${buf.length} bytes · ${isPdf ? "%PDF OK" : "NÃO é PDF!"}`);

  console.log(`\n🎯 E2E COMPLETO OK — doc #${docId}, PDF ${buf.length} bytes (${isPdf ? "válido" : "INVÁLIDO"})`);
  console.log(`   (documento de teste id=${docId} criado em produção — remover se necessário)`);
}
main().catch((e) => { console.error("✗ FALHOU:", e.message); process.exit(1); });
