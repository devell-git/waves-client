"use client";

/**
 * Criação de documento na Waves, COMPARTILHADA entre componentes (relatório de
 * cronograma, atualização executiva, …). Encapsula:
 *   - resolução do `document_type_id` pelo ESCOPO DO AGENTE (sem hardcode);
 *   - select de modelo quando o agente tem >1 tipo;
 *   - POST /documents + abertura do previewer.
 * Mantém o fluxo dual: o HTML já vem montado pelo runtime; o agente não monta.
 */
import { useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { loadSession } from "../session";
import { resolveAgentDocTypes, agentDocScopeStale, type DocType } from "../doc-types";

export async function rawJson(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const s = loadSession();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
  const r = await fetch(`/api/waves${path}`, { ...init, headers });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, data };
}

export type DocPhase = "idle" | "pick" | "creating" | "done";

function openFile(id: string, filename: string) {
  window.dispatchEvent(
    new CustomEvent("waves:open-file", {
      detail: { id, name: filename, mime: "application/pdf", kind: "document" },
    }),
  );
}

/** Hook: gera um documento Waves a partir de um HTML já montado, com seleção de
 *  tipo (do escopo do agente) quando houver mais de um. */
export function useWavesDoc(filename: string) {
  const [phase, setPhase] = useState<DocPhase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DocType[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const pending = useRef<{ html: string; title: string } | null>(null);
  const htmlRef = useRef<string>(""); // último HTML gerado — base do export Word/HTML

  const create = async (html: string, title: string, docTypeId: number | null) => {
    setPhase("creating");
    htmlRef.current = html;
    const session = loadSession();
    const body: Record<string, unknown> = { title, content: html };
    if (docTypeId != null) body.document_type_id = docTypeId;
    if (session?.user?.id != null) body.user_id = session.user.id;
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
    const newId = cd?.id ?? (cd?.document as Record<string, unknown>)?.id;
    if (newId == null) throw new Error("Documento criado sem id");
    setDocId(String(newId));
    setPhase("done");
    openFile(String(newId), filename);
  };

  /** Inicia a geração: resolve o tipo do agente; 1 → cria; >1 → abre o select. */
  const generate = async (html: string, title: string) => {
    setErr(null);
    try {
      const types = await resolveAgentDocTypes();
      if (!types.length && agentDocScopeStale()) {
        // Sessão antiga: o escopo de tipos do agente não foi carregado no login.
        // Não criamos com tipo errado nem mostramos o catálogo global (Eliana).
        setErr("Modelos do agente não carregados nesta sessão — saia e entre de novo para atualizar.");
        setPhase("idle");
        return;
      }
      if (types.length > 1) {
        pending.current = { html, title };
        setCandidates(types);
        setPicked(types[0]?.id ?? null);
        setPhase("pick");
        return;
      }
      await create(html, title, types[0]?.id ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar documento");
      setPhase("idle");
    }
  };

  const confirm = async () => {
    if (picked == null || !pending.current) return;
    setErr(null);
    try {
      await create(pending.current.html, pending.current.title, picked);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar documento");
      setPhase("pick");
    }
  };

  /** Baixa o documento em outro formato (Word .doc / HTML) a partir do mesmo
   *  HTML — PDF é o nativo da Waves (use openPreview). */
  const exportAs = async (format: "docx" | "doc" | "html", htmlOverride?: string) => {
    const html = htmlOverride || htmlRef.current;
    if (!html) return;
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, filename, format }),
      });
      if (!r.ok) throw new Error(`Falha no export (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "html" ? "html" : format === "doc" ? "doc" : "docx";
      a.download = `${filename.replace(/\.(pdf|docx?|html?)$/i, "")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no export");
    }
  };

  return {
    phase,
    err,
    docId,
    candidates,
    picked,
    setPicked,
    generate,
    confirm,
    exportAs,
    openPreview: () => docId && openFile(docId, filename),
  };
}

/** Seletor de formato pós-geração: abre o PDF (Waves) ou baixa Word. */
export function FormatChooser({
  onOpenPdf,
  onExport,
}: {
  onOpenPdf: () => void;
  onExport: (format: "docx" | "doc" | "html") => void;
}) {
  return (
    <span className="waves-file-download-wrap" style={{ display: "inline-flex", flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>Baixar como:</span>
      <button type="button" className="waves-file-download" onClick={onOpenPdf} title="Abrir/baixar o PDF gerado pela Waves">
        <FileText size={16} />
        <span className="waves-file-download__name">PDF</span>
      </button>
      <button type="button" className="waves-doc-action" onClick={() => onExport("docx")} title="Baixar em Word (.docx) — não passa pela Waves">
        <Download size={16} />
        <span className="waves-doc-action__name">Word</span>
      </button>
    </span>
  );
}

/** Select de modelo de documento (aparece só quando o agente tem >1 tipo). */
export function DocTypePicker({
  candidates,
  picked,
  setPicked,
  onConfirm,
  err,
}: {
  candidates: DocType[];
  picked: number | null;
  setPicked: (id: number) => void;
  onConfirm: () => void;
  err?: string | null;
}) {
  return (
    <span className="waves-file-download-wrap" style={{ display: "inline-flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, opacity: 0.85 }}>Modelo do documento:</span>
      <select
        value={picked == null ? "" : String(picked)}
        onChange={(e) => setPicked(Number(e.target.value))}
        style={{
          fontSize: 13,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--border, #cbd5e1)",
          background: "var(--background, #fff)",
          color: "inherit",
        }}
      >
        {candidates.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name}
          </option>
        ))}
      </select>
      <button type="button" className="waves-file-download" onClick={onConfirm} disabled={picked == null}>
        <Download size={16} />
        <span className="waves-file-download__name">Gerar</span>
      </button>
      {err && <span className="waves-file-download__err">{err}</span>}
    </span>
  );
}
