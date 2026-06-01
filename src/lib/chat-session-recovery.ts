/**
 * Recuperação após queda de rede: revalida login, recarrega thread e retoma
 * a última requisição ao chat (ex.: clique em sugestão sem resposta).
 */

import type { Message } from "@openuidev/react-headless";
import {
  getThreadMessages,
  stripFormStateWrapper,
  toOpenUIMessage,
} from "../api/threads";
import { verifyApiSession } from "../api/waves-api";
import type { AuthSession } from "../types/auth";
import { isRetryableNetworkError } from "./chat-fetch-retry";
import type { PendingChatRequest } from "./pending-chat-request";

export type ChatRecoveryResult =
  | {
      ok: true;
      messages: Message[];
      /** Retomar o POST /api/chat com pendingContent. */
      needsResend: boolean;
      pendingContent?: string;
    }
  | { ok: false; reason: "session_expired" | "network" | "no_message" };

function normalizeUserContent(content: string): string {
  return stripFormStateWrapper(content).trim();
}

function messageContent(m: Message): string {
  return typeof m.content === "string" ? m.content : String(m.content ?? "");
}

/** O Hermes já devolveu resposta de assistente para essa pergunta do user? */
function serverHasAnswerForPending(
  serverMessages: Message[],
  pendingNorm: string,
): boolean {
  for (let i = serverMessages.length - 1; i >= 0; i--) {
    if (serverMessages[i].role !== "user") continue;
    if (normalizeUserContent(messageContent(serverMessages[i])) !== pendingNorm) {
      continue;
    }
    const next = serverMessages[i + 1];
    if (next?.role === "assistant") {
      return messageContent(next).trim().length > 0;
    }
    return false;
  }
  return false;
}

/**
 * Remove turno incompleto da UI antes de reenviar (assistant parcial + user duplicado).
 */
export function trimMessagesForResume(messages: Message[]): Message[] {
  let trimmed = [...messages];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/**
 * Verifica token Waves, busca histórico e decide se deve retomar a última requisição.
 */
export async function recoverChatSession(params: {
  session: AuthSession;
  profileId: string;
  fullThreadKey: string;
  pendingUserContent: string;
  /** Requisição salva no momento do envio (conteúdo exato, com tags de follow-up). */
  storedPending?: PendingChatRequest | null;
}): Promise<ChatRecoveryResult> {
  const pending =
    params.storedPending?.content?.trim() || params.pendingUserContent.trim();
  if (!pending) {
    return { ok: false, reason: "no_message" };
  }
  const pendingNorm = normalizeUserContent(pending);

  try {
    const sessionOk = await verifyApiSession(params.session);
    if (!sessionOk) {
      return { ok: false, reason: "session_expired" };
    }

    const raw = await getThreadMessages(params.profileId, params.fullThreadKey);
    const messages = raw
      .map(toOpenUIMessage)
      .filter((m): m is Message => m !== null);

    const answered = serverHasAnswerForPending(messages, pendingNorm);

    if (params.storedPending || !answered) {
      return {
        ok: true,
        messages,
        needsResend: !answered,
        pendingContent: pending,
      };
    }

    return { ok: true, messages, needsResend: false };
  } catch (err) {
    if (isRetryableNetworkError(err)) {
      return { ok: false, reason: "network" };
    }
    throw err;
  }
}
