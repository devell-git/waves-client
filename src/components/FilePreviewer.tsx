import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Share2, X } from "lucide-react";
import { loadSession } from "../lib/session";
import { getActiveGateway } from "../api/threads";

/** URL de /api/share-recipients com host/port do gateway ativo (apps desacopladas). */
function shareRecipientsUrl(profile: string): string {
  const gw = getActiveGateway();
  const qs = new URLSearchParams({ profile });
  if (gw?.host) qs.set("host", gw.host);
  if (gw?.port != null) qs.set("port", String(gw.port));
  return `/api/share-recipients?${qs.toString()}`;
}

interface Recipient {
  user_id: string;
  name: string;
}

// Previewer de arquivos (Task 723 + 724). Escuta `waves:open-file`
// ({id, name, mime}) — disparado pelo sino ao clicar numa notificação
// `file_shared` (ou por qualquer outro lugar que queira abrir um arquivo).
// Busca `/api/files/:id` com o Bearer do usuário (acesso = owner OU shared_with),
// previsualiza por tipo (imagem / PDF / texto) e oferece DOWNLOAD.

interface FileRef {
  id: string;
  name: string;
  mime?: string;
  // "file" = /api/files/:id (registrado, shared_with). "document" = documento da
  // Waves (/api/waves/documents/:id/pdf, acesso governado pela Waves).
  kind?: "file" | "document";
}

export function FilePreviewer({ profile }: { profile?: string }) {
  const [file, setFile] = useState<FileRef | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // Blob carregado (p/ documento Waves: re-registramos no /api/files ao
  // compartilhar, garantindo acesso por usuário via shared_with). docFileId
  // cacheia o id do arquivo registrado nesta sessão (1 upload, N destinatários).
  const [blob, setBlob] = useState<Blob | null>(null);
  const [docFileId, setDocFileId] = useState<string | null>(null);

  // Abre ao receber o evento.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<FileRef>).detail;
      if (d?.id) setFile({ id: d.id, name: d.name || "arquivo", mime: d.mime, kind: d.kind });
    };
    window.addEventListener("waves:open-file", h);
    return () => window.removeEventListener("waves:open-file", h);
  }, []);

  // Busca o arquivo (autenticado) quando muda.
  useEffect(() => {
    if (!file) return;
    let objUrl: string | null = null;
    setLoading(true);
    setErr(null);
    setUrl(null);
    setText(null);
    setBlob(null);
    setDocFileId(null);
    (async () => {
      try {
        const s = loadSession();
        const isDoc = file.kind === "document";
        const fetchUrl = isDoc
          ? `/api/waves/documents/${encodeURIComponent(file.id)}/pdf`
          : `/api/files/${encodeURIComponent(file.id)}`;
        const r = await fetch(fetchUrl, {
          headers: s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {},
        });
        if (!r.ok) {
          setErr(
            r.status === 403
              ? "Você não tem acesso a este arquivo."
              : r.status === 404
                ? "Arquivo não encontrado."
                : `Falha ao carregar (${r.status}).`,
          );
          return;
        }
        const blob = await r.blob();
        setBlob(blob);
        const mime = file.mime || (isDoc ? "application/pdf" : blob.type) || "";
        if (mime.startsWith("text/") || mime === "application/json") {
          setText(await blob.text());
        } else {
          objUrl = URL.createObjectURL(blob);
          setUrl(objUrl);
        }
      } catch {
        setErr("Falha ao carregar o arquivo.");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [file]);

  if (!file) return null;

  const mime = file.mime || "";
  const close = () => {
    setFile(null);
    setUrl(null);
    setText(null);
    setErr(null);
    setShareOpen(false);
    setShareMsg(null);
  };

  const toggleShare = async () => {
    setShareMsg(null);
    const next = !shareOpen;
    setShareOpen(next);
    if (next && recipients.length === 0 && profile) {
      try {
        const s = loadSession();
        const r = await fetch(shareRecipientsUrl(profile), {
          headers: s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {},
        });
        const d = (await r.json()) as { recipients?: Recipient[] };
        const me = String(s?.user?.id ?? "");
        setRecipients((d.recipients ?? []).filter((x) => x.user_id !== me));
      } catch {
        /* sem destinatários */
      }
    }
  };

  const shareWith = async (uid: string, name: string) => {
    if (!file) return;
    setShareMsg("Compartilhando…");
    try {
      const s = loadSession();
      const auth: Record<string, string> = s?.accessToken
        ? { Authorization: `Bearer ${s.accessToken}` }
        : {};

      // DOCUMENTO Waves: registra o PDF no NOSSO /api/files (1x por sessão) e
      // compartilha o ARQUIVO → acesso por usuário (shared_with), garantido.
      // FILE: compartilha direto (já é /api/files).
      let fileId = file.kind === "document" ? docFileId : file.id;
      if (file.kind === "document" && !fileId) {
        if (!blob) {
          setShareMsg("Aguarde o documento carregar…");
          return;
        }
        const fd = new FormData();
        fd.append("file", new File([blob], file.name, { type: file.mime || "application/pdf" }));
        const up = await fetch("/api/files", { method: "POST", headers: auth, body: fd });
        if (!up.ok) {
          setShareMsg(`Falha ao preparar o arquivo (${up.status}).`);
          return;
        }
        fileId = ((await up.json()) as { id: string }).id;
        setDocFileId(fileId);
      }

      const r = await fetch(`/api/files/${fileId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ to_user_id: Number(uid), profile, file_name: file.name }),
      });
      if (r.ok) {
        setShareMsg(`✅ Compartilhado com ${name}`);
        setTimeout(() => setShareOpen(false), 1300);
      } else if (r.status === 403) {
        setShareMsg("Só o dono pode compartilhar este arquivo.");
      } else {
        setShareMsg(`Falha ao compartilhar (${r.status}).`);
      }
    } catch {
      setShareMsg("Falha ao compartilhar.");
    }
  };
  const download = () => {
    const a = document.createElement("a");
    let tmp: string | null = null;
    if (url) {
      a.href = url;
    } else if (text != null) {
      tmp = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
      a.href = tmp;
    } else {
      return;
    }
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (tmp) URL.revokeObjectURL(tmp);
  };

  const isImg = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <FileText size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{file.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {profile && (
              <button
                type="button"
                onClick={toggleShare}
                className={`inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-accent ${
                  shareOpen ? "bg-accent" : ""
                }`}
                title="Compartilhar"
              >
                <Share2 size={14} /> Compartilhar
              </button>
            )}
            <button
              type="button"
              onClick={download}
              disabled={loading || !!err}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="Baixar"
            >
              <Download size={14} /> Baixar
            </button>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
              title="Fechar"
            >
              <X size={16} />
            </button>
          </span>
        </header>

        {/* Painel de compartilhamento (destinatários = usuários do agente) */}
        {shareOpen && (
          <div className="border-b bg-muted/30 px-4 py-2.5">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Compartilhar com
            </div>
            {recipients.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Nenhum outro usuário encontrado neste agente.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((rcp) => (
                  <button
                    key={rcp.user_id}
                    type="button"
                    onClick={() => shareWith(rcp.user_id, rcp.name)}
                    className="rounded-full border border-input bg-background px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    {rcp.name}
                  </button>
                ))}
              </div>
            )}
            {shareMsg && <div className="mt-2 text-xs text-foreground">{shareMsg}</div>}
          </div>
        )}

        <div className="min-h-[220px] flex-1 overflow-auto bg-muted/20">
          {loading && (
            <div className="p-10 text-center text-sm text-muted-foreground">Carregando…</div>
          )}
          {err && <div className="p-10 text-center text-sm text-destructive">{err}</div>}
          {!loading && !err && text != null && (
            <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-relaxed">{text}</pre>
          )}
          {!loading && !err && url && isImg && (
            <img src={url} alt={file.name} className="mx-auto max-h-[78vh] object-contain" />
          )}
          {!loading && !err && url && isPdf && (
            <iframe src={url} title={file.name} className="h-[78vh] w-full border-0" />
          )}
          {!loading && !err && url && !isImg && !isPdf && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Pré-visualização não disponível para este tipo de arquivo.
              <br />
              Use o botão <strong>Baixar</strong> acima.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
