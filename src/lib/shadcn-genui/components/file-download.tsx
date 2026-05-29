"use client";

import { defineComponent } from "@openuidev/react-lang";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { loadSession } from "../../session";

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
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const handleClick = async () => {
      if (loading) return;
      setErr(null);
      setLoading(true);
      try {
        const session = loadSession();
        const headers: Record<string, string> = {};
        if (session?.accessToken) {
          headers.Authorization = `Bearer ${session.accessToken}`;
        }
        const res = await fetch(`/api/files/${encodeURIComponent(props.id)}`, {
          headers,
        });
        if (!res.ok) {
          const msg =
            res.status === 403
              ? "Sem permissão para este arquivo"
              : res.status === 401
                ? "Sessão expirada — faça login"
                : res.status === 404
                  ? "Arquivo não encontrado"
                  : `Erro ${res.status}`;
          throw new Error(msg);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = props.filename || "arquivo";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha no download");
      } finally {
        setLoading(false);
      }
    };

    const size = fmtBytes(props.size);

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={handleClick}
          disabled={loading}
          title={`Baixar ${props.filename}`}
        >
          {loading ? (
            <Loader2 size={18} className="waves-file-download__spin" />
          ) : (
            iconFor(props.mimeType, props.filename)
          )}
          <span className="waves-file-download__name">{props.filename}</span>
          {size && <span className="waves-file-download__size">{size}</span>}
          {!loading && <Download size={16} className="waves-file-download__dl" />}
        </button>
        {err && <span className="waves-file-download__err">{err}</span>}
      </span>
    );
  },
});
