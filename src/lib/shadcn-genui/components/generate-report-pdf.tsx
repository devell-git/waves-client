"use client";

import { defineComponent } from "@openuidev/react-lang";
import { CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ensureToolProvider } from "../../openui-tools";
import { buildReportHtml, type ReportRow } from "../../report-html";
import { loadSession } from "../../session";

const Schema = z.object({
  // workflow (AP) cujos dados viram o relatório. O RUNTIME busca os dados —
  // o agente NÃO manda dados nem HTML (sem bloat na sessão).
  workflow_id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  filename: z.string().optional(),
  label: z.string().optional(),
});

type Phase = "idle" | "data" | "doc" | "pdf" | "done";

async function rawJson(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const s = loadSession();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
  const r = await fetch(`/api/waves${path}`, { ...init, headers });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, data };
}

/** Resolve um document_type_id válido (o 1º disponível). */
async function resolveDocTypeId(): Promise<number | null> {
  const { data } = await rawJson("/document-types");
  const d = (data?.data ?? data) as Record<string, unknown>;
  // A Waves devolve { data: { document_types: [...] } }; cobrimos também rows/data/array.
  const list = (d?.document_types ?? d?.rows ?? d?.data ?? (Array.isArray(d) ? d : Array.isArray(data) ? data : [])) as Array<
    Record<string, unknown>
  >;
  const first = Array.isArray(list) ? list.find((x) => x && x.id != null) : null;
  return first ? Number(first.id) : null;
}

/**
 * Botão "Gerar PDF" que roda 100% no RUNTIME: busca os dados do workflow
 * (mesma base dos relatórios da tela), monta o HTML executivo COMPLETO
 * (saúde + pendências + carga), cria o DOCUMENTO na Waves (POST /api/documents)
 * e baixa o PDF gerado pela própria Waves (GET /documents/{id}/pdf).
 *
 * Por que no runtime: o agente nunca vê os dados (fluxo dual GENERATE/EXECUTE),
 * então um PDF montado por ele sai pobre. Aqui o navegador tem os dados →
 * PDF FIEL à tela, e a sessão do agente fica leve (só emite este botão).
 */
export const GenerateReportPdf = defineComponent({
  name: "GenerateReportPdf",
  props: Schema,
  description:
    "Botão que GERA o PDF executivo de um workflow no runtime (sem você montar HTML nem ver dados). " +
    "Busca os dados, monta o HTML completo (saúde do cronograma + pendências críticas + carga por responsável), " +
    "cria o documento na Waves e baixa o PDF. Props: workflow_id (obrigatório), title?, subtitle?, filename?, label?. " +
    "USE ISTO para qualquer pedido de PDF/relatório em PDF — NÃO monte HTML, NÃO chame POST /api/documents você mesmo.",
  component: ({ props }) => {
    const [phase, setPhase] = useState<Phase>("idle");
    const [err, setErr] = useState<string | null>(null);
    const wid = Number(props.workflow_id);
    const filename = props.filename || `relatorio-ap-${wid}.pdf`;

    const run = async () => {
      if (phase !== "idle" && phase !== "done") return;
      setErr(null);
      try {
        // 1) dados ao vivo (mesma base dos relatórios da tela)
        setPhase("data");
        const provider = await ensureToolProvider();
        const res = (await provider.get_schedule_health({ workflow_id: wid })) as { rows?: ReportRow[] };
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        if (!rows.length) throw new Error("Sem tarefas para este workflow");

        // 2) HTML executivo completo (runtime tem os dados → PDF fiel à tela)
        const html = buildReportHtml(rows, {
          title: props.title || `Relatório executivo — AP ${wid}`,
          subtitle: props.subtitle,
        });

        // 3) cria o documento na Waves
        setPhase("doc");
        const session = loadSession();
        const userId = session?.user?.id;
        const docTypeId = await resolveDocTypeId();
        const body: Record<string, unknown> = {
          title: props.title || `Relatório executivo — AP ${wid}`,
          content: html,
        };
        if (docTypeId != null) body.document_type_id = docTypeId;
        if (userId != null) body.user_id = userId;
        const created = await rawJson("/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!created.ok) {
          throw new Error(
            created.status === 403 ? "Sem permissão para criar documento" : `Erro ao criar documento (${created.status})`,
          );
        }
        const cd = (created.data?.data ?? created.data) as Record<string, unknown>;
        const docId = cd?.id ?? (cd?.document as Record<string, unknown>)?.id;
        if (docId == null) throw new Error("Documento criado sem id");

        // 4) baixa o PDF gerado pela Waves
        setPhase("pdf");
        const s2 = loadSession();
        const ph: Record<string, string> = {};
        if (s2?.accessToken) ph.Authorization = `Bearer ${s2.accessToken}`;
        const pdf = await fetch(`/api/waves/documents/${encodeURIComponent(String(docId))}/pdf`, { headers: ph });
        if (!pdf.ok) throw new Error(`Erro ao baixar PDF (${pdf.status})`);
        const blob = await pdf.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setPhase("done");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao gerar PDF");
        setPhase("idle");
      }
    };

    const busy = phase === "data" || phase === "doc" || phase === "pdf";
    const label =
      phase === "data"
        ? "Buscando dados…"
        : phase === "doc"
          ? "Gerando documento…"
          : phase === "pdf"
            ? "Baixando PDF…"
            : phase === "done"
              ? "PDF gerado — baixar de novo"
              : props.label || "Gerar PDF";

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={run}
          disabled={busy}
          title={busy ? label : `Gerar ${filename}`}
        >
          {busy ? (
            <Loader2 size={18} className="waves-file-download__spin" />
          ) : phase === "done" ? (
            <CheckCircle2 size={18} />
          ) : (
            <FileText size={18} />
          )}
          <span className="waves-file-download__name">{label}</span>
          {!busy && phase !== "done" && <Download size={16} className="waves-file-download__dl" />}
        </button>
        {err && <span className="waves-file-download__err">{err}</span>}
      </span>
    );
  },
});
