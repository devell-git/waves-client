"use client";

import { FileText, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildAnalysisChartsHtml, buildProjectChartsHtml, type ExecTask } from "../../report-html";
import { sanitizeHtml } from "../../sanitize-html";
import { rawJson, useWavesDoc } from "../waves-doc";
import { loadSession } from "../../session";
import { getCachedReport, putCachedReport } from "../../report-cache";
import { InlineJobProgress } from "./inline-job-progress";
import { getActiveGateway } from "../../../api/threads";
import { getWorkflowList, loadWorkflowTasksFull } from "../../openui-tools";

/** Agregado do PROJETO inteiro (todos os APs) — números consistentes (atraso =
 *  due<agora && !concluída && !cancelada), evitando o LLM remontar à mão. */
function buildProjectSummary(wfs: Array<{ id: number; name: string; tasks: Array<{ due_date: string | null; done_date: string | null; status: string }> }>) {
  const now = Date.now();
  const isCancel = (s: string) => /^(cancel|rejeit|arquiv|descart)/i.test(s || "");
  let n_tarefas = 0;
  let concluidas = 0;
  let em_atraso = 0;
  const por_ap = wfs
    .map((w) => {
      const done = w.tasks.filter((t) => t.done_date).length;
      const venc = w.tasks.filter(
        (t) => t.due_date && !t.done_date && !isCancel(t.status) && new Date(t.due_date).getTime() < now,
      ).length;
      n_tarefas += w.tasks.length;
      concluidas += done;
      em_atraso += venc;
      return { id: w.id, ap: w.name.split(/\s+[—–-]\s+/)[0].trim(), nome: w.name, tasks: w.tasks.length, abertas: w.tasks.length - done, vencidas: venc, concluidas: done };
    })
    .filter((a) => a.tasks > 0);
  return {
    escopo: "Projeto (todos os Action Plans)",
    n_aps: wfs.length,
    n_aps_com_tarefas: por_ap.length,
    n_tarefas,
    concluidas,
    abertas: n_tarefas - concluidas,
    em_atraso,
    por_ap: por_ap.sort((a, b) => b.vencidas - a.vencidas || b.tasks - a.tasks),
  };
}

function findTaskList(o: unknown): ExecTask[] {
  if (Array.isArray(o) && o.length && typeof o[0] === "object") return o as ExecTask[];
  if (o && typeof o === "object") {
    for (const k of ["tasks", "rows", "data", "items"]) {
      const v = (o as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as ExecTask[];
    }
    for (const v of Object.values(o as Record<string, unknown>)) {
      const r = findTaskList(v);
      if (r.length) return r;
    }
  }
  return [];
}

async function rawJsonRetry(path: string, tries = 4): Promise<Awaited<ReturnType<typeof rawJson>>> {
  let last = await rawJson(path);
  for (let i = 1; i < tries && last.status === 429; i++) {
    await new Promise((r) => setTimeout(r, 1000 * i));
    last = await rawJson(path);
  }
  return last;
}

/** Agregados do AP (sem os itens crus) — base pra IA escrever o relatório. */
function buildSummary(tasks: ExecTask[], ap: string, workflow: string) {
  const roots = tasks.filter((t) => t.parent_id == null);
  const subs = tasks.filter((t) => t.parent_id != null);
  const custo = (t: ExecTask) => {
    const v = t.template_fields?.custo_estimado;
    return typeof v === "number" && Number.isFinite(v) && v ? v : null;
  };
  const acoes = roots.map((t) => ({
    id: t.id,
    titulo: t.title,
    custo: custo(t),
    feitas: (t.items ?? []).filter((i) => i.checked).length,
    total_itens: (t.items ?? []).length,
    inicio: (t.start_date ?? "").slice(0, 10),
    fim: (t.due_date ?? "").slice(0, 10),
    subtarefas: (t.children ?? []).length,
  }));
  return {
    ap,
    workflow,
    n_acoes: roots.length,
    n_subtarefas: subs.length,
    n_tarefas: tasks.reduce((s, t) => s + (t.items?.length ?? 0), 0),
    concluidas: tasks.reduce((s, t) => s + (t.items ?? []).filter((i) => i.checked).length, 0),
    custo_total: acoes.reduce((s, r) => s + (r.custo ?? 0), 0),
    sem_custo: acoes.filter((r) => r.custo == null).map((r) => ({ id: r.id, titulo: r.titulo })),
    acoes,
  };
}

/**
 * Relatório ANALÍTICO/CUSTOM escrito pela IA, focado na INSTRUÇÃO do usuário
 * (ex.: "gargalos, pendências e riscos"). 100% runtime: busca as tasks, manda
 * agregados + a instrução pro modelo (sem bloat), renderiza o HTML na tela e
 * oferece PDF/Word. Diferente do executivo (determinístico) — aqui o conteúdo
 * é escrito pela IA, sob medida pro pedido.
 *
 * Disparado pelo marcador `analysis_report:{...}` (tool generate_analysis_report).
 */
export function AnalysisReport({
  workflow_id,
  instruction,
  ap_number,
  scope,
}: {
  workflow_id: number | string;
  instruction: string;
  ap_number?: string;
  scope?: string;
}) {
  const wid = Number(workflow_id);
  const isProject = scope === "project" || (!wid && !ap_number);
  const [stage, setStage] = useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [apLabel, setApLabel] = useState<string>(isProject ? "Projeto" : ap_number ? String(ap_number) : String(wid));
  const filename = isProject ? "relatorio-analitico-projeto.pdf" : `relatorio-analitico-ap-${apLabel}.pdf`;
  const docTitle = isProject ? "Relatório Analítico — Projeto" : `Relatório Analítico — AP ${apLabel}`;
  const doc = useWavesDoc(filename);
  const started = useRef(false);

  // Idempotência (task #791): se já geramos este relatório nesta thread, hidrata o
  // HTML salvo em vez de re-buscar — senão o reload/remount regenera (LLM) um
  // relatório DIFERENTE. Chave = thread + params do marcador.
  const cacheKey = `analysis:${wid}:${ap_number ?? ""}:${scope ?? ""}:${instruction}`;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const cached = getCachedReport(cacheKey);
    if (cached) {
      setHtml(cached);
      setStage("ready");
      return;
    }
    (async () => {
      try {
        // ── Modo PROJETO: agrega TODOS os APs (números consistentes) ──────────
        if (isProject) {
          const list = await getWorkflowList();
          const wfs: Array<{ id: number; name: string; tasks: Awaited<ReturnType<typeof loadWorkflowTasksFull>> }> = [];
          for (const w of list) {
            try {
              wfs.push({ id: w.id, name: w.name, tasks: await loadWorkflowTasksFull(w.id) });
            } catch {
              /* pula AP que falhou */
            }
          }
          if (!wfs.length) throw new Error("Não consegui carregar os workflows do projeto");
          const psum = buildProjectSummary(wfs);
          const s2 = loadSession();
          const gw2 = getActiveGateway();
          const r2 = await fetch("/api/analysis-report", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(s2?.accessToken ? { Authorization: `Bearer ${s2.accessToken}` } : {}) },
            body: JSON.stringify({ summary: psum, instruction, host: gw2?.host, port: gw2?.port }),
          });
          const j2 = (await r2.json().catch(() => ({}))) as { html?: string; error?: string };
          if (!r2.ok || !j2.html) throw new Error(j2.error || "A IA não retornou o relatório");
          const fullHtml = j2.html + buildProjectChartsHtml(psum);
          setHtml(fullHtml);
          putCachedReport(cacheKey, fullHtml);
          setStage("ready");
          return;
        }
        // nome do workflow (título/contexto) + nº do AP
        let name = "";
        try {
          const wfRes = await rawJsonRetry(`/workflows/${wid}`);
          const root = wfRes.data as Record<string, unknown>;
          const dataNode = (root?.data ?? root) as Record<string, unknown>;
          const wf = (dataNode?.workflow ?? dataNode) as Record<string, unknown>;
          name = typeof wf?.name === "string" ? wf.name : "";
        } catch {
          /* segue */
        }
        const ap = ap_number ? String(ap_number) : name.split(/\s+[—–-]\s+/)[0].trim() || String(wid);
        setApLabel(ap);
        const res = await rawJsonRetry(`/workflows/${wid}/tasks`);
        if (!res.ok) throw new Error(`Falha ao buscar tasks (${res.status})`);
        const tasks = findTaskList(res.data);
        if (!tasks.length) throw new Error("Workflow sem tarefas");
        const summary = buildSummary(tasks, ap, name);

        const s = loadSession();
        const gw = getActiveGateway();
        const r = await fetch("/api/analysis-report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {}),
          },
          body: JSON.stringify({ summary, instruction, host: gw?.host, port: gw?.port }),
        });
        const j = (await r.json().catch(() => ({}))) as { html?: string; error?: string };
        if (!r.ok || !j.html) throw new Error(j.error || "A IA não retornou o relatório");
        // Narrativa (IA) + gráficos DETERMINÍSTICOS (números exatos dos dados).
        const fullHtml = j.html + buildAnalysisChartsHtml(summary);
        setHtml(fullHtml);
        putCachedReport(cacheKey, fullHtml);
        setStage("ready");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao gerar o relatório analítico");
        setStage("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === "loading") {
    return <InlineJobProgress label="Gerando análise (IA)…" />;
  }
  if (stage === "error") {
    return (
      <span className="waves-file-download-wrap">
        <span className="waves-file-download__err">{err}</span>
      </span>
    );
  }

  const creating = doc.phase === "creating";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 8,
          padding: 12,
          maxHeight: 460,
          overflow: "auto",
          background: "#fff",
          color: "#111",
          fontFamily: "Arial,Helvetica,sans-serif",
          fontSize: 13,
          lineHeight: 1.5,
        }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      />
      <span className="waves-file-download-wrap" style={{ display: "inline-flex", flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="waves-file-download"
          onClick={() => (doc.phase === "done" ? doc.openPreview() : doc.generate(html, docTitle))}
          disabled={creating}
          title={doc.phase === "done" ? "Abrir o PDF" : "Gerar PDF na Waves"}
        >
          {creating ? <Loader2 size={18} className="waves-file-download__spin" /> : <FileText size={18} />}
          <span className="waves-file-download__name">{creating ? "Gerando PDF…" : doc.phase === "done" ? "Abrir PDF" : "PDF"}</span>
        </button>
        <button type="button" className="waves-doc-action" onClick={() => doc.exportAs("docx", html)} title="Baixar em Word (.docx)">
          <span className="waves-doc-action__name">Word</span>
        </button>
        {doc.err && <span className="waves-file-download__err">{doc.err}</span>}
      </span>
    </div>
  );
}
