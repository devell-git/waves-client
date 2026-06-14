import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listThreads,
  searchThreads,
  renameThread,
  deleteThread,
  type SearchHit,
  type ThreadSummary,
} from "../api/threads";
import { sanitizeHtml } from "../lib/sanitize-html";

interface ThreadHistoryProps {
  profileId: string;
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  /** Bump pra forçar reload (ex.: depois de mandar uma message nova). */
  refreshTrigger?: number;
}

function formatRelative(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  const d = new Date(ms);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function fallbackTitle(t: ThreadSummary): string {
  if (t.title) return t.title;
  if (t.preview) return t.preview.slice(0, 80);
  return "Sem título";
}

export function ThreadHistory({
  profileId,
  activeThreadId,
  onSelectThread,
  refreshTrigger,
}: ThreadHistoryProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Debounce da busca: dispara só 250ms depois da última tecla
  const searchTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const t = await listThreads(profileId);
    setThreads(t);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    reload();
  }, [reload, refreshTrigger]);

  useEffect(() => {
    if (searchTimer.current != null) window.clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      const found = await searchThreads(profileId, q);
      setHits(found);
    }, 250);
    return () => {
      if (searchTimer.current != null) window.clearTimeout(searchTimer.current);
    };
  }, [profileId, query]);

  const displayed = useMemo(() => {
    if (hits == null) return threads;
    // mapeia hits → lista parecida com ThreadSummary pra render
    return hits.map<ThreadSummary>((h) => ({
      id: h.threadId,
      title: h.title,
      messageCount: 0,
      lastUpdated: h.lastUpdated,
      preview: h.snippet,
    }));
  }, [hits, threads]);

  const startRename = (t: ThreadSummary) => {
    setEditing(t.id);
    setEditValue(fallbackTitle(t));
  };

  const commitRename = async (threadId: string) => {
    const title = editValue.trim();
    if (title) {
      await renameThread(profileId, threadId, title);
    }
    setEditing(null);
    setEditValue("");
    reload();
  };

  const handleDelete = async (threadId: string) => {
    if (!confirm("Excluir esta conversa? Esta ação não pode ser desfeita.")) return;
    await deleteThread(profileId, threadId);
    reload();
  };

  return (
    <div className="thread-history">
      <div className="thread-search">
        <input
          type="search"
          placeholder="Buscar conversas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar conversas"
        />
      </div>

      <div className="thread-history-list">
        {loading && threads.length === 0 && (
          <div className="thread-history-empty">Carregando…</div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="thread-history-empty">
            {query ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
          </div>
        )}
        {displayed.map((t) => {
          const active = t.id === activeThreadId;
          const isEditing = editing === t.id;
          return (
            <div
              key={t.id}
              className={`thread-item ${active ? "thread-item-active" : ""}`}
              onClick={() => !isEditing && onSelectThread(t.id)}
            >
              <div className="thread-item-main">
                {isEditing ? (
                  <input
                    autoFocus
                    className="thread-item-edit"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(t.id);
                      if (e.key === "Escape") {
                        setEditing(null);
                        setEditValue("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="thread-item-title"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(t);
                    }}
                    title="Duplo-clique pra renomear"
                  >
                    {hits ? (
                      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.preview || fallbackTitle(t)) }} />
                    ) : (
                      fallbackTitle(t)
                    )}
                  </span>
                )}
                <span className="thread-item-meta">{formatRelative(t.lastUpdated)}</span>
              </div>
              {!isEditing && (
                <button
                  type="button"
                  className="thread-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(t.id);
                  }}
                  aria-label="Excluir"
                  title="Excluir conversa"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
