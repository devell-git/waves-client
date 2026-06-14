"use client";

import { defineComponent } from "@openuidev/react-lang";
import { CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { buildExecutiveUpdateHtml, type ExecTask } from "../../report-html";
import { sanitizeHtml } from "../../sanitize-html";
import { rawJson, useWavesDoc, DocTypePicker } from "../waves-doc";
import { loadSession } from "../../session";
import { getActiveGateway } from "../../../api/threads";

/**
 * Análise (LLM) do relatório — modo analítico. Manda só AGREGADOS (sem os itens
 * de checklist) pro `/api/analyze-report`, que chama o modelo (one-shot, sem
 * SOUL). Devolve `{conclusion, analysisHtml}` ou null (→ texto-template).
 */
async function fetchReportAnalysis(
  tasks: ExecTask[],
  ap: string,
  workflowName: string,
): Promise<{ conclusion?: string; analysisHtml?: string } | null> {
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
  const summary = {
    ap,
    workflow: workflowName,
    n_acoes: roots.length,
    n_subtarefas: subs.length,
    n_tarefas: tasks.reduce((s, t) => s + (t.items?.length ?? 0), 0),
    concluidas: tasks.reduce((s, t) => s + (t.items ?? []).filter((i) => i.checked).length, 0),
    custo_total: acoes.reduce((s, r) => s + (r.custo ?? 0), 0),
    sem_custo: acoes.filter((r) => r.custo == null).map((r) => ({ id: r.id, titulo: r.titulo })),
    acoes,
  };
  const s = loadSession();
  const gw = getActiveGateway();
  const r = await fetch("/api/analyze-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {}),
    },
    body: JSON.stringify({ summary, host: gw?.host, port: gw?.port }),
  });
  if (!r.ok) return null;
  return (await r.json()) as { conclusion?: string; analysisHtml?: string };
}

const Schema = z.object({
  // workflow (AP) cujas tasks viram o Relatório Executivo de Atualização.
  workflow_id: z.union([z.number(), z.string()]),
  // número do AP exibido no título (ex.: "6.4"). Default = workflow_id.
  ap_number: z.union([z.number(), z.string()]).optional(),
  // estilo do relatório: completo (default) | resumido (sem o §4 detalhado) |
  // analitico (completo + Leitura analítica gerada por LLM).
  // 3º posicional DE PROPÓSITO — assim "analítico" não exige passar `null` no org
  // (o openui-lang NÃO aceita literal `null` → quebraria a renderização).
  mode: z.enum(["completo", "resumido", "analitico"]).optional(),
  // rótulo da organização no topo (opcional; o branding real vem do DocumentType).
  org: z.string().optional(),
  filename: z.string().optional(),
  label: z.string().optional(),
});

/** rawJson com retry/backoff no 429 (rate limit transitório da Waves). */
async function rawJsonRetry(path: string, tries = 4): Promise<Awaited<ReturnType<typeof rawJson>>> {
  let last = await rawJson(path);
  for (let i = 1; i < tries && last.status === 429; i++) {
    await new Promise((r) => setTimeout(r, 1000 * i)); // 1s, 2s, 3s
    last = await rawJson(path);
  }
  return last;
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

/**
 * Relatório Executivo de Atualização (formato "Timbrado Bioshield"): tarefas
 * principais, subtarefas, checklist principal/por subtarefa, prazos e valores.
 *
 * 100% RUNTIME (fluxo dual): ao ser emitido pelo agente, JÁ busca as tasks do
 * workflow, monta o HTML EXATO (nomenclatura fixa) e RENDERIZA NA TELA — sem
 * botão intermediário. Abaixo do preview, botões de formato (PDF / Word) geram
 * cada um no seu formato. PDF = documento na Waves com o `document_type` do
 * escopo do agente (select se houver mais de um). O agente NÃO monta HTML.
 */
export const GenerateExecutiveUpdate = defineComponent({
  name: "GenerateExecutiveUpdate",
  props: Schema,
  description:
    "Gera o RELATÓRIO EXECUTIVO DE ATUALIZAÇÃO de um AP (tarefas, subtarefas, checklists, prazos e valores) no runtime. " +
    "Ao emitir, ele JÁ busca as tasks, monta o HTML no formato/nomenclatura padrão e mostra na tela, com botões PDF/Word. " +
    "Props: workflow_id (obrigatório), ap_number?, org?, filename?, label?. " +
    "USE quando pedirem o relatório executivo/atualização de um AP em documento. NÃO monte HTML nem mande os dados você mesmo.",
  component: ({ props }) => {
    const wid = Number(props.workflow_id);
    // nº do AP (do prop ou derivado do nome) + NOME EXATO do workflow.
    const [apNumber, setApNumber] = useState<string>(props.ap_number != null ? String(props.ap_number) : "");
    const [wfName, setWfName] = useState<string>("");
    const apLabel = apNumber || String(wid);
    // Título e arquivo levam o nome EXATO do workflow quando disponível.
    const docTitle = `Relatório Executivo de Atualização do AP ${wfName || apLabel}`;
    const safeBase =
      (wfName || `ap-${apLabel}`).replace(/[^\w.\- ]+/g, "_").replace(/[\s_]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) ||
      `ap-${apLabel}`;
    const filename = props.filename || `relatorio-executivo-${safeBase}.pdf`;
    const doc = useWavesDoc(filename);

    const [stage, setStage] = useState<"loading" | "ready" | "error">("loading");
    const [loadingMsg, setLoadingMsg] = useState("Montando relatório executivo…");
    const [html, setHtml] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const started = useRef(false);

    // Auto-monta ao ser emitido: resolve nº do AP → busca tasks → HTML → preview.
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      (async () => {
        try {
          // 1) workflow: nome EXATO + nº do AP (deriva do nome se o prop não veio).
          let name = "";
          try {
            const wfRes = await rawJsonRetry(`/workflows/${wid}`);
            const root = wfRes.data as Record<string, unknown>;
            const dataNode = (root?.data ?? root) as Record<string, unknown>;
            const wf = (dataNode?.workflow ?? dataNode) as Record<string, unknown>;
            name = typeof wf?.name === "string" ? wf.name : "";
          } catch {
            /* segue sem nome */
          }
          // "6.4 — Ação Precursora…" → "6.4" (separa no traço cercado de espaço).
          const ap = props.ap_number != null ? String(props.ap_number) : name.split(/\s+[—–-]\s+/)[0].trim() || String(wid);
          setWfName(name);
          setApNumber(ap);
          // 2) tasks → HTML (com o nome exato do workflow no título).
          const res = await rawJsonRetry(`/workflows/${wid}/tasks`);
          if (!res.ok) throw new Error(`Falha ao buscar tasks (${res.status})`);
          const tasks = findTaskList(res.data);
          if (!tasks.length) throw new Error("Workflow sem tarefas");
          // Detecção ROBUSTA do modo: aceita "analitico"/"resumido"/"completo"
          // em QUALQUER prop string (mode/org/ap_number) — assim independe da
          // ordem posicional dos args ou de bundle antigo. O agente às vezes
          // coloca o modo no slot errado; aqui sempre pega.
          const MODES = ["completo", "resumido", "analitico"] as const;
          const mode =
            ([props.mode, props.org, props.ap_number].find(
              (v) => typeof v === "string" && (MODES as readonly string[]).includes(v),
            ) as (typeof MODES)[number] | undefined) ?? "completo";
          // Modo analítico: complementa com Leitura analítica + conclusão por LLM
          // (agregados apenas — sem os itens; degrada pro template se falhar).
          let conclusion: string | undefined;
          let analysisHtml: string | undefined;
          if (mode === "analitico") {
            try {
              setLoadingMsg("Gerando leitura analítica (IA)… pode levar alguns segundos");
              const an = await fetchReportAnalysis(tasks, ap, name);
              conclusion = an?.conclusion;
              analysisHtml = an?.analysisHtml;
            } catch {
              /* sem análise → cai no texto-template */
            }
          }
          setHtml(buildExecutiveUpdateHtml(tasks, { apNumber: ap, workflowName: name, org: props.org, mode, conclusion, analysisHtml }));
          setStage("ready");
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Falha ao montar o relatório");
          setStage("error");
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (stage === "loading") {
      return (
        <span className="waves-file-download-wrap">
          <span className="waves-file-download">
            <Loader2 size={18} className="waves-file-download__spin" />
            <span className="waves-file-download__name">{loadingMsg}</span>
          </span>
        </span>
      );
    }
    if (stage === "error") {
      return (
        <span className="waves-file-download-wrap">
          <span className="waves-file-download__err">{err}</span>
        </span>
      );
    }

    const creating = doc.phase === "creating";
    const pdfDone = doc.phase === "done";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Preview na tela (HTML determinístico do runtime, não vem do LLM). */}
        <div
          style={{
            border: "1px solid var(--border, #e2e8f0)",
            borderRadius: 8,
            padding: 12,
            maxHeight: 420,
            overflow: "auto",
            background: "#fff",
            color: "#111",
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(html ?? "") }}
        />

        {doc.phase === "pick" ? (
          // PDF precisa do modelo (DocumentType) quando o agente tem >1.
          <DocTypePicker
            candidates={doc.candidates}
            picked={doc.picked}
            setPicked={doc.setPicked}
            onConfirm={doc.confirm}
            err={doc.err}
          />
        ) : (
          <span className="waves-file-download-wrap" style={{ display: "inline-flex", flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {/* PDF — documento na Waves (timbrado) + abre o modal. */}
            <button
              type="button"
              className="waves-file-download"
              onClick={() => (pdfDone ? doc.openPreview() : doc.generate(html ?? "", docTitle))}
              disabled={creating}
              title={pdfDone ? "Abrir o PDF gerado" : "Gerar PDF na Waves"}
            >
              {creating ? (
                <Loader2 size={18} className="waves-file-download__spin" />
              ) : pdfDone ? (
                <CheckCircle2 size={18} />
              ) : (
                <FileText size={18} />
              )}
              <span className="waves-file-download__name">{creating ? "Gerando PDF…" : pdfDone ? "Abrir PDF" : "PDF"}</span>
            </button>
            {/* Word — exporta o mesmo HTML como .doc (download direto via
                /api/export; NÃO passa pela Waves, que só devolve PDF). */}
            <button
              type="button"
              className="waves-doc-action"
              onClick={() => doc.exportAs("docx", html ?? "")}
              title="Baixar em Word (.docx) — não passa pela Waves"
            >
              <Download size={16} />
              <span className="waves-doc-action__name">Word</span>
            </button>
            {doc.err && <span className="waves-file-download__err">{doc.err}</span>}
          </span>
        )}
      </div>
    );
  },
});
