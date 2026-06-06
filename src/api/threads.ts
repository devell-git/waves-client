/**
 * Cliente HTTP pro histórico de conversas (Express → state.db do Hermes).
 *
 * Inclui conversões pro formato do `@openuidev/react-headless` (Thread,
 * Message) usado pelo ChatProvider — assim o `useThreadList` nativo
 * gerencia a lista, e click numa thread carrega via `loadThread` callback.
 */

import type { Thread, Message } from "@openuidev/react-headless";

export interface ThreadSummary {
  id: string;
  title: string | null;
  messageCount: number;
  lastUpdated: number;
  preview: string | null;
}

export interface SearchHit {
  threadId: string;
  title: string | null;
  snippet: string;
  lastUpdated: number;
}

export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  toolCalls: unknown[] | null;
  toolName: string | null;
  toolCallId: string | null;
  timestamp: number;
}

// ── Contexto do gateway (token + host/port do agent ativo) ──────────────────
// Apps DESACOPLADAS: o histórico vem do gateway Hermes por HTTP (não mais do
// filesystem). O server precisa do Bearer do usuário + host/port do agent pra
// rotear. O ChatPage chama `setThreadGateway` quando o agent/sessão muda.
interface ThreadGateway {
  token: string;
  host?: string;
  port?: number;
}
let GW: ThreadGateway | null = null;

export function setThreadGateway(gw: ThreadGateway | null): void {
  GW = gw;
}

function gwHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (GW?.token) h["Authorization"] = `Bearer ${GW.token}`;
  return h;
}

function gwQuery(profileId: string): string {
  const p = new URLSearchParams();
  if (profileId) p.set("profile", profileId);
  if (GW?.host) p.set("host", GW.host);
  if (GW?.port != null) p.set("port", String(GW.port));
  return p.toString();
}

export async function listThreads(profileId: string): Promise<ThreadSummary[]> {
  const r = await fetch(`/api/threads?${gwQuery(profileId)}`, { headers: gwHeaders() });
  if (!r.ok) return [];
  const j = (await r.json()) as { threads?: ThreadSummary[] };
  return j.threads ?? [];
}

export async function searchThreads(profileId: string, query: string): Promise<SearchHit[]> {
  const url = `/api/threads/search?${gwQuery(profileId)}&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: gwHeaders() });
  if (!r.ok) return [];
  const j = (await r.json()) as { hits?: SearchHit[] };
  return j.hits ?? [];
}

export async function getThreadMessages(
  profileId: string,
  threadId: string,
): Promise<ThreadMessage[]> {
  const url = `/api/threads/${encodeURIComponent(threadId)}/messages?${gwQuery(profileId)}`;
  const r = await fetch(url, { headers: gwHeaders() });
  if (!r.ok) return [];
  const j = (await r.json()) as { messages?: ThreadMessage[] };
  return j.messages ?? [];
}

export async function renameThread(
  profileId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  const url = `/api/threads/${encodeURIComponent(threadId)}?${gwQuery(profileId)}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: gwHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ title }),
  });
  if (!r.ok) return false;
  const j = (await r.json()) as { ok?: boolean };
  return Boolean(j.ok);
}

export async function deleteThread(profileId: string, threadId: string): Promise<boolean> {
  const url = `/api/threads/${encodeURIComponent(threadId)}?${gwQuery(profileId)}`;
  const r = await fetch(url, { method: "DELETE", headers: gwHeaders() });
  if (!r.ok) return false;
  const j = (await r.json()) as { ok?: boolean };
  return Boolean(j.ok);
}

/**
 * Gera um threadId curto novo. Usado quando o user clica em "New Chat" ou
 * abre o app sem thread persistida.
 */
export function newThreadId(): string {
  // crypto.randomUUID() está disponível em navegadores modernos
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

// ── Conversões: API Express → tipos do @openuidev/react-headless ────────────

function fallbackThreadTitle(t: ThreadSummary): string {
  return t.title || t.preview?.slice(0, 80) || "Sem título";
}

export function toOpenUIThread(t: ThreadSummary): Thread {
  return {
    id: t.id,
    title: fallbackThreadTitle(t),
    createdAt: t.lastUpdated,
  };
}

/**
 * Converte uma mensagem do nosso backend (state.db do Hermes) pro formato
 * `Message` do `@ag-ui/core`. Filtra mensagens internas (tool results vazios,
 * etc) que não devem aparecer na UI mas mantém tool_calls quando relevante.
 */
export function toOpenUIMessage(m: ThreadMessage): Message | null {
  const id = String(m.id);
  switch (m.role) {
    case "user":
      // Submits do form chegam wrapped em <content>...</content><context>...</context>.
      // Extraímos a parte legível pra UI.
      return {
        id,
        role: "user",
        content: stripFormStateWrapper(m.content),
      };
    case "assistant":
      return {
        id,
        role: "assistant",
        content: m.content || undefined,
        toolCalls: Array.isArray(m.toolCalls)
          ? (m.toolCalls as Array<Record<string, unknown>>).map((tc, i) => ({
              id: String(tc.id ?? `tc-${id}-${i}`),
              type: "function",
              function: {
                name: String((tc.function as Record<string, unknown>)?.name ?? tc.name ?? ""),
                arguments: String(
                  (tc.function as Record<string, unknown>)?.arguments ??
                    tc.arguments ??
                    "",
                ),
              },
            }))
          : undefined,
      };
    case "tool":
      return {
        id,
        role: "tool",
        toolCallId: m.toolCallId ?? `tc-${id}`,
        content: m.content || "",
      } as Message;
    default:
      return null;
  }
}

/** Texto legível da mensagem user (remove wrappers de form/follow-up). */
export function stripFormStateWrapper(raw: string): string {
  const m = raw.match(/<content>([\s\S]*?)<\/content>/);
  if (m && m[1]) return m[1].trim();
  if (raw === "__form_cnpj__") return "Consultar CNPJ";
  if (raw === "__form_cpf__") return "Consultar CPF";
  if (raw === "__form_cnpj_map__") return "Consultar MAP";
  return raw;
}

// ── Adapters pro ChatProvider (react-headless) ──────────────────────────────

/**
 * Factory de callbacks `fetchThreadList`/`loadThread`/`updateThread`/`deleteThread`
 * pra passar pro `<ChatProvider>`. Todos vinculados ao profile ativo.
 */
export function createThreadApiAdapters(profileId: string) {
  return {
    fetchThreadList: async (): Promise<{ threads: Thread[] }> => {
      const t = await listThreads(profileId);
      return { threads: t.map(toOpenUIThread) };
    },
    loadThread: async (threadId: string): Promise<Message[]> => {
      const msgs = await getThreadMessages(profileId, threadId);
      return msgs
        .map(toOpenUIMessage)
        .filter((m): m is Message => m !== null);
    },
    updateThread: async (thread: Thread): Promise<Thread> => {
      await renameThread(profileId, thread.id, thread.title);
      return thread;
    },
    deleteThread: async (threadId: string): Promise<void> => {
      await deleteThread(profileId, threadId);
    },
  };
}
