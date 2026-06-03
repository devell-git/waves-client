"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { loadSession } from "../../session";

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
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const filename = props.filename || `documento-${props.docId}.pdf`;

    const handleClick = async () => {
      if (loading) return;
      setErr(null);
      setLoading(true);
      try {
        const session = loadSession();
        const headers: Record<string, string> = {};
        if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
        const res = await fetch(
          `/api/waves/documents/${encodeURIComponent(String(props.docId))}/pdf`,
          { headers },
        );
        if (!res.ok) {
          const msg =
            res.status === 403
              ? "Sem permissão para este documento"
              : res.status === 401
                ? "Sessão expirada — faça login"
                : res.status === 404
                  ? "Documento não encontrado"
                  : `Erro ${res.status}`;
          throw new Error(msg);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
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

    return (
      <span className="waves-file-download-wrap">
        <button
          type="button"
          className="waves-file-download"
          onClick={handleClick}
          disabled={loading}
          title={`Baixar ${filename}`}
        >
          {loading ? (
            <Loader2 size={18} className="waves-file-download__spin" />
          ) : (
            <FileText size={18} />
          )}
          <span className="waves-file-download__name">{props.label || "Baixar PDF"}</span>
          {!loading && <Download size={16} className="waves-file-download__dl" />}
        </button>
        {err && <span className="waves-file-download__err">{err}</span>}
      </span>
    );
  },
});
