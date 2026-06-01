/**
 * Guarda a última mensagem enviada ao `/api/chat` por thread, para retomar
 * a mesma requisição após queda de rede (ex.: clique em FollowUp sem resposta).
 */

const STORAGE_PREFIX = "waves_pending_chat_v1:";

export interface PendingChatRequest {
  /** Chave completa `waves-user-<id>::<threadId>`. */
  threadKey: string;
  /** Conteúdo exato passado ao `processMessage` (com `<content>` / `<context>`). */
  content: string;
  savedAt: number;
}

function storageKey(threadKey: string): string {
  return `${STORAGE_PREFIX}${threadKey}`;
}

export function savePendingChatRequest(threadKey: string, content: string): void {
  if (!threadKey || !content.trim()) return;
  try {
    const entry: PendingChatRequest = {
      threadKey,
      content,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function loadPendingChatRequest(threadKey: string): PendingChatRequest | null {
  try {
    const raw = sessionStorage.getItem(storageKey(threadKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChatRequest;
    if (parsed.threadKey !== threadKey || !parsed.content?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingChatRequest(threadKey: string): void {
  try {
    sessionStorage.removeItem(storageKey(threadKey));
  } catch {
    /* ignore */
  }
}
