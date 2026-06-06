"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Eye, FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";
import { z } from "zod";

const FileDownloadSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
});

function fmtBytes(n?: number): string | null {
  if (!n && n !== 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime?: string, name?: string) {
  const s = `${mime ?? ""} ${name ?? ""}`;
  if (/^image\//.test(mime ?? "")) return <ImageIcon size={18} />;
  if (/sheet|excel|csv/i.test(s)) return <FileSpreadsheet size={18} />;
  return <FileText size={18} />;
}

/**
 * Arquivo que o AGENTE envia pro usuário baixar. Renderiza um chip clicável
 * que baixa `/api/files/<id>` com a autenticação do usuário (Bearer do Babble
 * lido da sessão). O servidor valida o token + dono antes de servir.
 */
export const FileDownload = defineComponent({
  name: "FileDownload",
  props: FileDownloadSchema,
  description:
    "A downloadable file the agent sends to the user. Renders a clickable chip that securely downloads the file. Props (positional): id (the uuid of the file registered server-side), filename, mimeType?, size?. Use when offering a generated report/export/document. For showing an image inline use Image instead.",
  component: ({ props }) => {
    // Abre o PREVIEWER (ver + Baixar + Compartilhar dentro). Sem download direto.
    const open = () =>
      window.dispatchEvent(
        new CustomEvent("waves:open-file", {
          detail: { id: props.id, name: props.filename, mime: props.mimeType, kind: "file" },
        }),
      );
    const size = fmtBytes(props.size);

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={open}
          title={`Abrir ${props.filename}`}
        >
          {iconFor(props.mimeType, props.filename)}
          <span className="waves-file-download__name">{props.filename}</span>
          {size && <span className="waves-file-download__size">{size}</span>}
          <Eye size={16} className="waves-file-download__dl" />
        </button>
      </span>
    );
  },
});
