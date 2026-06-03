// Persistência LOCAL (localStorage) das mensagens geradas por ATALHO
// determinístico (Gantt/kanban), que renderizam sem passar pelo /api/chat e por
// isso NÃO são gravadas no state.db do Hermes. Sem isto, somem no reload (o
// ThreadRestorer re-semeia só com o histórico do gateway). Guardamos por
// fullThreadKey e o ThreadRestorer mescla por timestamp. Per-browser — ok pra
// views efêmeras (dá pra re-pedir, é instantâneo).

export interface ShortcutMsg {
  role: "user" | "assistant";
  content: string;
  ts: number; // epoch ms
}

const PREFIX = "waves-shortcut::";
const MAX = 40; // teto por thread (evita crescer sem fim)

function key(threadKey: string): string {
  return `${PREFIX}${threadKey}`;
}

export function loadShortcuts(threadKey: string): ShortcutMsg[] {
  if (typeof window === "undefined" || !threadKey) return [];
  try {
    const raw = window.localStorage.getItem(key(threadKey));
    const arr = raw ? (JSON.parse(raw) as ShortcutMsg[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Grava o par user→assistant de um atalho no thread. */
export function saveShortcutExchange(
  threadKey: string,
  userText: string,
  assistantContent: string,
): void {
  if (typeof window === "undefined" || !threadKey) return;
  try {
    const now = Date.now();
    const cur = loadShortcuts(threadKey);
    cur.push({ role: "user", content: userText, ts: now });
    cur.push({ role: "assistant", content: assistantContent, ts: now + 1 });
    window.localStorage.setItem(key(threadKey), JSON.stringify(cur.slice(-MAX)));
  } catch {
    /* localStorage cheio / indisponível — ignora (só perde persistência) */
  }
}

export function clearShortcuts(threadKey: string): void {
  if (typeof window === "undefined" || !threadKey) return;
  try {
    window.localStorage.removeItem(key(threadKey));
  } catch {
    /* ignore */
  }
}
