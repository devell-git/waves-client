"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Eye, FileText } from "lucide-react";
import { z } from "zod";

const Schema = z.object({
  // id do DOCUMENTO na Waves (retornado pelo POST /api/documents).
  docId: z.union([z.number(), z.string()]),
  filename: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Botão de download do PDF de um DOCUMENTO da Waves. Faz GET
 * `/api/waves/documents/<docId>/pdf` (o proxy injeta X-API-KEY + repassa o
 * Bearer do usuário) — o PDF é GERADO PELA WAVES (header/footer/background do
 * DocumentType), não pelo agent local. Use depois de criar o documento via
 * POST /api/documents (skill manage-documents): mande o conteúdo, pegue o id,
 * e ofereça este botão. Assim o relatório vira documento NA Waves e o PDF sai
 * da própria plataforma.
 */
export const WavesDocPdf = defineComponent({
  name: "WavesDocPdf",
  props: Schema,
  description:
    "Botão que baixa o PDF de um DOCUMENTO da Waves (GET /api/documents/{docId}/pdf, gerado pela própria Waves). " +
    "Props: docId (id do documento retornado pelo POST /api/documents), filename?, label?. " +
    "Fluxo p/ PDF de relatório: NÃO gere PDF local — crie o documento na Waves (POST /api/documents com o HTML) " +
    "e ofereça `WavesDocPdf(<docId>, \"relatorio.pdf\")`. O botão faz o GET do PDF da Waves.",
  component: ({ props }) => {
    const filename = props.filename || `documento-${props.docId}.pdf`;
    // Abre o PREVIEWER (ver + Baixar + Compartilhar dentro). Sem download direto.
    const open = () =>
      window.dispatchEvent(
        new CustomEvent("waves:open-file", {
          detail: { id: String(props.docId), name: filename, mime: "application/pdf", kind: "document" },
        }),
      );

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={open}
          title={`Abrir ${filename}`}
        >
          <FileText size={18} />
          <span className="waves-file-download__name">{props.label || "Abrir relatório"}</span>
          <Eye size={16} className="waves-file-download__dl" />
        </button>
      </span>
    );
  },
});
