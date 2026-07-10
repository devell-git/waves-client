import React, { useCallback, useEffect, useRef } from "react";
import {
  useThread,
  useThreadList,
  type Message,
} from "@openuidev/react-headless";
import {
  setRunningThread,
  clearRunningThread,
  markBackgroundRun,
  clearBackgroundRun,
  useBackgroundJobWatcher,
  useBackgroundRunWatcher,
} from "../../lib/active-runs";
import { toOpenUIMessage } from "../../api/threads";
import type { ThreadMessage } from "../../api/threads";

export function FileUploadBridge({ bridgeRef }: { bridgeRef: React.MutableRefObject<((files: any[]) => void) | null> }) {
  const sendMsg = useThread((s) => s.processMessage);
  useEffect(() => {
    bridgeRef.current = (files) => {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "binary"; mimeType: string; url: string; filename: string }
      > = [];
      for (const f of files) {
        parts.push({ type: "binary", mimeType: f.mimeType, url: f.url, filename: f.filename });
      }
      sendMsg({ role: "user", content: parts });
    };
    return () => { bridgeRef.current = null; };
  }, [sendMsg, bridgeRef]);
  return null;
}

export function ThreadSelector({ targetThreadId }: { targetThreadId: string }) {
  const selectedId = useThreadList((s) => s.selectedThreadId);
  const selectThread = useThreadList((s) => s.selectThread);
  const threads = useThreadList((s) => s.threads);
  const isLoading = useThreadList((s) => s.isLoadingThreads);

  useEffect(() => {
    if (isLoading) return;
    if (selectedId === targetThreadId) return;
    if (threads.some((t) => t.id === targetThreadId)) {
      selectThread(targetThreadId);
    }
  }, [isLoading, selectedId, targetThreadId, threads, selectThread]);

  return null;
}

export function RunTracker({ activeThreadId }: { activeThreadId: string }) {
  const isRunning = useThread((s) => s.isRunning);
  const wasRunning = useRef(false);
  const runOriginRef = useRef<string>("");
  useEffect(() => {
    if (isRunning && !wasRunning.current) {
      setRunningThread(activeThreadId);
      markBackgroundRun(activeThreadId);
      runOriginRef.current = activeThreadId;
    } else if (!isRunning && wasRunning.current) {
      clearRunningThread();
      if (runOriginRef.current && runOriginRef.current === activeThreadId) {
        clearBackgroundRun(runOriginRef.current);
      }
      runOriginRef.current = "";
    }
    wasRunning.current = isRunning;
  }, [isRunning, activeThreadId]);
  return null;
}

export function BackgroundJobWatcher() {
  useBackgroundJobWatcher();
  return null;
}

export function ScrollAnchorOnOpen({ threadKey }: { threadKey: string }) {
  const messages = useThread((s) => s.messages);
  const isRunning = useThread((s) => s.isRunning);
  const anchoredFor = useRef<string>("");
  useEffect(() => {
    if (!threadKey || isRunning) return;
    if (messages.length === 0) {
      anchoredFor.current = "";
      return;
    }
    if (anchoredFor.current === threadKey) return;
    const el = document.querySelector<HTMLElement>(".openui-shell-thread-scroll-area");
    if (!el) return;
    anchoredFor.current = threadKey;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, threadKey, isRunning]);
  return null;
}

export function BackgroundRunWatcher({
  profileId,
  threadKeyPrefix,
  activeThreadId,
}: {
  profileId: string;
  threadKeyPrefix: string;
  activeThreadId: string;
}) {
  const setMessages = useThread((s) => s.setMessages);
  const onActiveThreadDone = useCallback(
    (msgs: ThreadMessage[]) => {
      const conv = msgs.map(toOpenUIMessage).filter(Boolean) as Message[];
      if (conv.length) setMessages(conv);
    },
    [setMessages],
  );
  useBackgroundRunWatcher({ profileId, threadKeyPrefix, activeThreadId, onActiveThreadDone });
  return null;
}

export function ChatAppendListener() {
  const appendMessages = useThread((s) => s.appendMessages);
  useEffect(() => {
    const h = (e: Event) => {
      const content = (e as CustomEvent<{ content: string }>).detail?.content;
      if (typeof content === "string" && content) {
        appendMessages({ id: crypto.randomUUID(), role: "assistant", content });
      }
    };
    window.addEventListener("waves:chat-append", h);
    return () => window.removeEventListener("waves:chat-append", h);
  }, [appendMessages]);
  return null;
}
