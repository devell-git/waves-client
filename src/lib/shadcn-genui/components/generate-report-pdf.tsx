"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ensureToolProvider } from "../../openui-tools";
import { buildReportHtml, type ReportRow } from "../../report-html";
import { useWavesDoc, DocTypePicker, FormatChooser } from "../waves-doc";

const Schema = z.object({
  // workflow (AP) cujos dados viram o relatório. O RUNTIME busca os dados —
  // o agente NÃO manda dados nem HTML (sem bloat na sessão).
  workflow_id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  filename: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Botão "Gerar PDF" que roda 100% no RUNTIME: busca os dados do workflow
 * (mesma base dos relatórios da tela), monta o HTML executivo COMPLETO
 * (saúde + pendências + carga) e cria o DOCUMENTO na Waves via `useWavesDoc`
 * (que resolve o `document_type` pelo ESCOPO DO AGENTE — nunca o "1º global" —
 * e mostra um select quando há mais de um modelo).
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
    const wid = Number(props.workflow_id);
    const filename = props.filename || `relatorio-ap-${wid}.pdf`;
    const docTitle = props.title || `Relatório executivo — AP ${wid}`;
    const doc = useWavesDoc(filename);
    const [loadingData, setLoadingData] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const run = async () => {
      if (loadingData || doc.phase === "creating") return;
      setErr(null);
      setLoadingData(true);
      try {
        // dados ao vivo (mesma base dos relatórios da tela)
        const provider = await ensureToolProvider();
        const res = (await provider.get_schedule_health({ workflow_id: wid })) as { rows?: ReportRow[] };
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        if (!rows.length) throw new Error("Sem tarefas para este workflow");
        // HTML executivo completo (runtime tem os dados → PDF fiel à tela)
        const html = buildReportHtml(rows, { title: docTitle, subtitle: props.subtitle });
        setLoadingData(false);
        // cria o documento (resolve tipo do agente; select se >1)
        await doc.generate(html, docTitle);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao gerar PDF");
        setLoadingData(false);
      }
    };

    // Select de modelo (só quando o agente tem >1 tipo de documento).
    if (doc.phase === "pick") {
      return (
        <DocTypePicker
          candidates={doc.candidates}
          picked={doc.picked}
          setPicked={doc.setPicked}
          onConfirm={doc.confirm}
          err={doc.err}
        />
      );
    }

    // Documento criado (PDF abriu no modal). Oferece PDF / Word / HTML.
    if (doc.phase === "done") {
      return <FormatChooser onOpenPdf={doc.openPreview} onExport={doc.exportAs} />;
    }

    const busy = loadingData || doc.phase === "creating";
    const label = loadingData
      ? "Buscando dados…"
      : doc.phase === "creating"
        ? "Gerando relatório…"
        : props.label || "Gerar relatório";
    const shownErr = err || doc.err;

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={run}
          disabled={busy}
          title={busy ? label : `Gerar ${filename}`}
        >
          {busy ? <Loader2 size={18} className="waves-file-download__spin" /> : <FileText size={18} />}
          <span className="waves-file-download__name">{label}</span>
          {!busy && <Download size={16} className="waves-file-download__dl" />}
        </button>
        {shownErr && <span className="waves-file-download__err">{shownErr}</span>}
      </span>
    );
  },
});
