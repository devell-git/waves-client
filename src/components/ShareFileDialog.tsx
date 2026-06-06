import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Send, X } from "lucide-react";
import { loadSession } from "../lib/session";

// Ponto de entrada de ENVIO do compartilhamento (Task 724, estilo WhatsApp):
// botão no header → escolhe um arquivo (upload p/ /api/files) + um destinatário
// (usuários do agente) → POST /api/files/:id/share → cai no sino do destinatário.

interface Recipient {
  user_id: string;
  name: string;
}

export function ShareFileDialog({ profile, userId }: { profile?: string; userId: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Mesmo slot do sino (.chat-shell-header-actions); observa até aparecer.
  useEffect(() => {
    const find = () => document.querySelector<HTMLElement>(".chat-shell-header-actions");
    const found = find();
    if (found) {
      setHost(found);
      return;
    }
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        setHost(el);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const openDialog = async () => {
    setOpen(true);
    setMsg(null);
    setFile(null);
    setTo("");
    if (profile) {
      try {
        const s = loadSession();
        const r = await fetch(`/api/share-recipients?profile=${encodeURIComponent(profile)}`, {
          headers: s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {},
        });
        const d = (await r.json()) as { recipients?: Recipient[] };
        setRecipients((d.recipients ?? []).filter((x) => x.user_id !== userId));
      } catch {
        setRecipients([]);
      }
    }
  };

  const send = async () => {
    if (!file) return setMsg("Escolha um arquivo.");
    if (!to) return setMsg("Escolha um destinatário.");
    setBusy(true);
    setMsg("Enviando…");
    try {
      const s = loadSession();
      const auth: Record<string, string> = s?.accessToken
        ? { Authorization: `Bearer ${s.accessToken}` }
        : {};
      // 1) upload → /api/files (owner = o próprio usuário, pelo token)
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/files", { method: "POST", headers: auth, body: fd });
      if (!up.ok) {
        setMsg(`Falha no upload (${up.status}).`);
        return;
      }
      const { id } = (await up.json()) as { id: string };
      // 2) compartilha com o destinatário → notificação no sino dele
      const sh = await fetch(`/api/files/${id}/share`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ to_user_id: Number(to), profile }),
      });
      if (sh.ok) {
        const name = recipients.find((r) => r.user_id === to)?.name ?? to;
        setMsg(`✅ Enviado para ${name}`);
        setTimeout(() => setOpen(false), 1400);
      } else {
        setMsg(`Falha ao compartilhar (${sh.status}).`);
      }
    } catch {
      setMsg("Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  };

  const trigger = (
    <button
      type="button"
      onClick={openDialog}
      title="Compartilhar arquivo"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Paperclip size={17} />
    </button>
  );

  return (
    <>
      {host ? createPortal(trigger, host) : createPortal(<div className="fixed right-16 top-3 z-[60]">{trigger}</div>, document.body)}

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[71] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="text-sm font-semibold">Compartilhar arquivo</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
                >
                  <X size={16} />
                </button>
              </header>
              <div className="space-y-3 p-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Arquivo
                  </label>
                  <input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Destinatário
                  </label>
                  <select
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
                  >
                    <option value="">Escolha quem recebe…</option>
                    {recipients.map((r) => (
                      <option key={r.user_id} value={r.user_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  {msg ? (
                    <span className="text-xs text-muted-foreground">{msg}</span>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={send}
                    disabled={busy || !file || !to}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send size={14} /> Enviar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
