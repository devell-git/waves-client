import { Bell, CheckCheck, FileText, ClipboardList, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadSession } from "../lib/session";

function authHeaders(): Record<string, string> {
  const s = loadSession();
  return s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {};
}

// Sino de notificações (Task 721). Polla GET /api/notifications por (profile,
// user_id), mostra badge de não-lidas e um painel com o histórico. Clicar num
// item marca como lido; se o item tem `data.task_id`, dispara `waves:open-task`
// (a Task 722 escuta isso pra abrir a task). Base p/ compartilhamento (Task 724).

interface Notif {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: { task_id?: number; file_id?: number | string; [k: string]: unknown } | null;
  read: boolean;
  created_at: number;
}

const POLL_MS = 20000;

function iconFor(type: string) {
  if (type === "task_assigned") return ClipboardList;
  if (type === "file_shared") return FileText;
  return Info;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NotificationBell({ profile, userId }: { profile: string; userId: string }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Slot do header do Shell (`.chat-shell-header-actions`) — aparece quando o
  // Shell monta; observamos o DOM até existir. Se não achar, fallback flutuante.
  const [host, setHost] = useState<HTMLElement | null>(null);
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

  const load = useCallback(async () => {
    if (!profile || !userId) return;
    try {
      const r = await fetch(
        `/api/notifications?profile=${encodeURIComponent(profile)}&user_id=${encodeURIComponent(userId)}`,
        { headers: authHeaders() },
      );
      if (!r.ok) return;
      const d = (await r.json()) as { notifications?: Notif[]; unread?: number };
      setItems(d.notifications ?? []);
      setUnread(d.unread ?? 0);
    } catch {
      /* silencioso — polling */
    }
  }, [profile, userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const post = (path: string) =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ profile, user_id: userId }),
    });

  const markAll = async () => {
    await post("/api/notifications/read-all");
    load();
  };

  const onClickItem = async (n: Notif) => {
    if (!n.read) {
      await post(`/api/notifications/${n.id}/read`);
      load();
    }
    if (n.data?.task_id) {
      window.dispatchEvent(
        new CustomEvent("waves:open-task", { detail: { task_id: n.data.task_id } }),
      );
      setOpen(false);
    } else if (n.data?.file_id || (n.data as Record<string, unknown>)?.document_id) {
      const dd = n.data as Record<string, unknown>;
      const isDoc = dd.document_id != null;
      window.dispatchEvent(
        new CustomEvent("waves:open-file", {
          detail: {
            id: String(isDoc ? dd.document_id : dd.file_id),
            name: String(dd.file_name ?? "arquivo"),
            mime: dd.mime as string | undefined,
            kind: isDoc ? "document" : "file",
          },
        }),
      );
      setOpen(false);
    }
  };

  const content = (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notificações"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notificações</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <CheckCheck size={13} /> marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Sem notificações.
              </div>
            ) : (
              items.map((n) => {
                const Icon = iconFor(n.type);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onClickItem(n)}
                    className={`flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/50 ${
                      n.read ? "opacity-60" : ""
                    }`}
                  >
                    <span className="mt-0.5 text-muted-foreground">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {!n.read && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <span className="truncate text-sm font-medium">{n.title}</span>
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      {n.data?.task_id != null && (
                        <span className="mt-0.5 block text-[11px] font-medium text-primary">
                          Abrir task #{n.data.task_id} →
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {timeAgo(n.created_at)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );

  // Renderiza no slot do header do Shell; se ainda não existe, flutua no canto.
  if (host) return createPortal(content, host);
  return createPortal(
    <div className="fixed right-4 top-3 z-[60]">{content}</div>,
    document.body,
  );
}
