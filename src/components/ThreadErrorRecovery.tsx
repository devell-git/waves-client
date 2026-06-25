/**
 * Ping em /api/health + retomada da última requisição.
 * Uma única mensagem; o banner some no 1º ping OK e não volta até limpar o erro.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useThread, useThreadList, type Message } from "@openuidev/react-headless";
import { fetchUserScope } from "../api/user-scope";
import {
  probeChatApi,
  SERVER_PING_INTERVAL_MS,
} from "../lib/connection-probe";
import { isRetryableNetworkError } from "../lib/chat-fetch-retry";
import {
  recoverChatSession,
  trimMessagesForResume,
} from "../lib/chat-session-recovery";
import {
  clearPendingChatRequest,
  loadPendingChatRequest,
} from "../lib/pending-chat-request";
import type { AuthSession } from "../types/auth";
import type { UserScope } from "../api/user-scope";

const RECOVER_STUCK_MS = 90_000;

type BannerPhase = "offline" | "waiting-server" | "checking";

function lastUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return null;
}

function phaseMessage(phase: BannerPhase): string {
  switch (phase) {
    case "offline":
      return "Sem conexão. Tentando de novo automaticamente…";
    case "waiting-server":
      return "Aguardando o servidor…";
    default:
      return "Verificando conexão…";
  }
}

export interface ThreadErrorRecoveryProps {
  session: AuthSession;
  profileId: string;
  fullThreadKey: string;
  onSessionExpired: () => void;
  onScopeRefresh?: (scope: UserScope) => void;
}

export function ThreadErrorRecovery({
  session,
  profileId,
  fullThreadKey,
  onSessionExpired,
  onScopeRefresh,
}: ThreadErrorRecoveryProps) {
  const threadError = useThread((s) => s.threadError);
  const messages = useThread((s) => s.messages);
  const setMessages = useThread((s) => s.setMessages);
  const processMessage = useThread((s) => s.processMessage);
  const isRunning = useThread((s) => s.isRunning);
  const selectThread = useThreadList((s) => s.selectThread);

  /** Após 1º ping OK neste erro: não mostrar banner de novo (evita piscar). */
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [phase, setPhase] = useState<BannerPhase>("checking");

  const recoverInFlightRef = useRef(false);
  const recoverStartedAtRef = useRef(0);
  const pingTimerRef = useRef<number | null>(null);
  const pingInFlightRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const errorKeyRef = useRef("");
  const resumeAttemptedRef = useRef(""); // #831 — resume-on-mount: 1x por thread

  const threadErrorRef = useRef(threadError);
  threadErrorRef.current = threadError;
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const isNetworkError =
    threadError != null && isRetryableNetworkError(threadError);

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current != null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const unlockRecoverIfStuck = useCallback(() => {
    if (
      recoverInFlightRef.current &&
      Date.now() - recoverStartedAtRef.current > RECOVER_STUCK_MS
    ) {
      recoverInFlightRef.current = false;
    }
  }, []);

  const runRecover = useCallback(async () => {
    unlockRecoverIfStuck();
    if (recoverInFlightRef.current || isRunningRef.current) return;

    const stored = loadPendingChatRequest(fullThreadKey);
    const lastUser = lastUserMessage(messagesRef.current);
    const fallbackContent =
      lastUser?.content != null
        ? typeof lastUser.content === "string"
          ? lastUser.content
          : String(lastUser.content)
        : "";
    const pendingContent = stored?.content?.trim() || fallbackContent.trim();
    if (!pendingContent) return;

    recoverInFlightRef.current = true;
    recoverStartedAtRef.current = Date.now();

    try {
      const result = await recoverChatSession({
        session,
        profileId,
        fullThreadKey,
        pendingUserContent: pendingContent,
        storedPending: stored,
      });

      if (!result.ok) {
        if (result.reason === "session_expired") {
          clearPendingChatRequest(fullThreadKey);
          onSessionExpired();
        }
        return;
      }

      if (onScopeRefresh) {
        try {
          onScopeRefresh(await fetchUserScope(session));
        } catch {
          /* opcional */
        }
      }

      if (result.needsResend && result.pendingContent) {
        setMessages(trimMessagesForResume(messagesRef.current));
        await processMessage({ role: "user", content: result.pendingContent });
        clearPendingChatRequest(fullThreadKey);
      } else {
        clearPendingChatRequest(fullThreadKey);
        selectThread(fullThreadKey);
      }
    } finally {
      recoverInFlightRef.current = false;
    }
  }, [
    session,
    profileId,
    fullThreadKey,
    setMessages,
    processMessage,
    selectThread,
    onSessionExpired,
    onScopeRefresh,
    unlockRecoverIfStuck,
  ]);

  const runRecoverRef = useRef(runRecover);
  runRecoverRef.current = runRecover;

  const scheduleRecover = useCallback(() => {
    unlockRecoverIfStuck();
    if (!recoverInFlightRef.current && !isRunningRef.current) {
      void runRecoverRef.current();
    }
  }, [unlockRecoverIfStuck]);

  const runServerPing = useCallback(async () => {
    const err = threadErrorRef.current;
    if (!err || !isRetryableNetworkError(err)) return;
    if (pingInFlightRef.current) return;

    pingInFlightRef.current = true;
    try {
      if (!navigator.onLine) {
        setPhase("offline");
        return;
      }

      setPhase("checking");
      const ok = await probeChatApi();
      if (!ok) {
        setPhase("waiting-server");
        return;
      }

      setBannerDismissed(true);
      setPhase("checking");
      scheduleRecover();
    } finally {
      pingInFlightRef.current = false;
    }
  }, [scheduleRecover]);

  const runServerPingRef = useRef(runServerPing);
  runServerPingRef.current = runServerPing;

  // Novo erro de rede → mostra banner de novo.
  useEffect(() => {
    if (!threadError || !isNetworkError) return;
    const key = `${threadError.message}::${threadError.name}`;
    if (errorKeyRef.current === key) return;
    errorKeyRef.current = key;
    setBannerDismissed(false);
    setPhase("checking");
  }, [threadError, isNetworkError]);

  // Ping periódico (deps estáveis — não reinicia ao mudar isRunning).
  useEffect(() => {
    if (!threadError || !isNetworkError) {
      errorKeyRef.current = "";
      setBannerDismissed(false);
      setPhase("checking");
      clearPingTimer();
      clearRetryTimer();
      return;
    }

    const tick = () => void runServerPingRef.current();
    tick();

    pingTimerRef.current = window.setInterval(tick, SERVER_PING_INTERVAL_MS);

    const onOnline = () => tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearPingTimer();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [threadError, isNetworkError, clearPingTimer, clearRetryTimer]);

  // Com banner já oculto (servidor OK), segue tentando recover até threadError sumir.
  useEffect(() => {
    if (!threadError || !bannerDismissed) {
      clearRetryTimer();
      return;
    }
    const tick = () => {
      if (!threadErrorRef.current) return;
      void runServerPingRef.current();
    };
    retryTimerRef.current = window.setInterval(tick, SERVER_PING_INTERVAL_MS);
    return () => clearRetryTimer();
  }, [threadError, bannerDismissed, clearRetryTimer]);

  // #831 — RESUME-ON-MOUNT: num RELOAD não há `threadError`, então o recover
  // normal (gated em erro de rede) NÃO dispara e a resposta em voo se perde.
  // Aqui, ao hidratar a thread: se a última msg é do user SEM resposta e há uma
  // requisição pendente salva (sessionStorage), retoma UMA vez (reusa o
  // `runRecover`, que decide reenviar vs recarregar do servidor). Se a conversa
  // já terminou (última = assistant), limpa a pendência latente — o fluxo normal
  // nunca a limpava, e sem isso o resume re-rodaria a cada reload.
  useEffect(() => {
    if (isRunning) return;
    if (messages.length === 0) return; // ainda hidratando
    const pending = loadPendingChatRequest(fullThreadKey);
    if (!pending) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      clearPendingChatRequest(fullThreadKey);
      return;
    }
    if (last?.role !== "user") return;
    if (resumeAttemptedRef.current === fullThreadKey) return;
    resumeAttemptedRef.current = fullThreadKey;
    void runRecoverRef.current();
  }, [messages, isRunning, fullThreadKey]);

  const showBanner = Boolean(
    threadError && isNetworkError && !bannerDismissed && !isRunning,
  );

  if (!showBanner) return null;

  return (
    <div className="waves-thread-error" role="status" aria-live="polite">
      <p className="waves-thread-error__title">Conexão interrompida</p>
      <p className="waves-thread-error__detail">{phaseMessage(phase)}</p>
    </div>
  );
}
