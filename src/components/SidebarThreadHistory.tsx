import { useEffect, useMemo, useRef, useState } from "react";
import { useThreadList } from "@openuidev/react-headless";
import {
  searchThreads,
  renameThread,
  type SearchHit,
} from "../api/threads";

interface SidebarThreadHistoryProps {
  profileId: string;
  onNewChat: () => void;
}

function formatRelative(ms: number | string | undefined): string {
  if (!ms) return "";
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n)) return "";
  const diff = Date.now() - n;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  const d = new Date(n);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/**
 * Histórico de conversas no sidebar, conectado ao `useThreadList` nativo do
 * `@openuidev/react-headless`. Renderizado dentro do `<ChatProvider>` no
 * ChatPage — assim selectThread/createThread/etc. atualizam o estado global
 * do chat e o `loadThread` callback do provider hidrata as messages.
 *
 * Funcionalidades:
 *  - Lista de threads (usa store nativo)
 *  - Busca FTS via /api/threads/search (modo overlay: substitui a lista)
 *  - Rename inline (duplo-clique)
 *  - Delete (botão ×)
 *  - "Nova conversa" button (acima da lista)
 */
export function SidebarThreadHistory({
  profileId,
  onNewChat,
}: SidebarThreadHistoryProps) {
  const threads = useThreadList((s) => s.threads);
  const selectedThreadId = useThreadList((s) => s.selectedThreadId);
  const selectThread = useThreadList((s) => s.selectThread);
  const deleteThreadAction = useThreadList((s) => s.deleteThread);
  const updateThreadAction = useThreadList((s) => s.updateThread);
  const isLoading = useThreadList((s) => s.isLoadingThreads);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const searchTimer = useRef<number | null>(null);

  // Debounce search
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

  // Lista final: hits (se buscando) ou threads do store
  const displayed = useMemo(() => {
    if (hits == null) {
      return threads.map((t) => ({
        id: t.id,
        title: t.title || "Sem título",
        meta: formatRelative(t.createdAt),
        isSnippet: false,
      }));
    }
    return hits.map((h) => ({
      id: h.threadId,
      title: h.snippet || h.title || "Sem título",
      meta: formatRelative(h.lastUpdated),
      isSnippet: true,
    }));
  }, [hits, threads]);

  const startRename = (id: string, currentTitle: string) => {
    setEditing(id);
    setEditValue(currentTitle);
  };

  const commitRename = async (threadId: string) => {
    const title = editValue.trim();
    if (title) {
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        // Atualiza no backend
        await renameThread(profileId, threadId, title);
        // Atualiza no store nativo
        updateThreadAction({ ...thread, title });
      }
    }
    setEditing(null);
    setEditValue("");
  };

  const handleDelete = async (threadId: string) => {
    if (!confirm("Excluir esta conversa? Esta ação não pode ser desfeita.")) return;
    // Backend (e a action do store também chama o `deleteThread` do provider que aponta pro backend)
    await deleteThreadAction(threadId);
  };

  return (
    <div className="thread-history-panel">
      <button type="button" className="thread-new-btn" onClick={onNewChat}>
        + Nova conversa
      </button>

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
        {isLoading && threads.length === 0 && (
          <div className="thread-history-empty">Carregando…</div>
        )}
        {!isLoading && displayed.length === 0 && (
          <div className="thread-history-empty">
            {query ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
          </div>
        )}
        {displayed.map((item) => {
          const active = item.id === selectedThreadId;
          const isEditing = editing === item.id;
          return (
            <div
              key={item.id}
              className={`thread-item ${active ? "thread-item-active" : ""}`}
              onClick={() => !isEditing && selectThread(item.id)}
            >
              <div className="thread-item-main">
                {isEditing ? (
                  <input
                    autoFocus
                    className="thread-item-edit"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(item.id);
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
                      startRename(item.id, item.title);
                    }}
                    title="Duplo-clique pra renomear"
                  >
                    {item.isSnippet ? (
                      <span dangerouslySetInnerHTML={{ __html: item.title }} />
                    ) : (
                      item.title
                    )}
                  </span>
                )}
                <span className="thread-item-meta">{item.meta}</span>
              </div>
              {!isEditing && (
                <button
                  type="button"
                  className="thread-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id);
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
