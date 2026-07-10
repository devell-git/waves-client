import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  openAIMessageFormat,
  type Message,
} from "@openuidev/react-headless";
import type { UploadedFile } from "../../api/uploads";
import {
  buildConversationStarters,
  fetchUserScope,
  type UserScope,
} from "../../api/user-scope";
import { fetchRuntime, type RuntimeInfo, type ProfileStarter } from "../../api/runtime";
import {
  type ProfileOption,
  loadActiveProfileId,
  saveActiveProfileId,
} from "../ProfileSelect";
import {
  createThreadApiAdapters,
  newThreadId,
  setThreadGateway,
} from "../../api/threads";
import { clearSession } from "../../lib/session";
import {
  useSessionGuard,
  setExpiredReason,
  type ExpireReason,
} from "../../lib/session-guard";
import { installAuthInterceptor } from "../../lib/fetch-interceptor";
import { fetchTenantBranding, type TenantBranding } from "../../lib/tenant";
import { setCreateTaskThreadKey } from "../../lib/createtask-consumed";
import { setReportThreadKey } from "../../lib/report-cache";
import { saveShortcutExchange } from "../../lib/shortcut-history";
import {
  ensureToolProvider,
  setActiveAgentId,
} from "../../lib/openui-tools";
import {
  setAdminFlag,
  isAdmin,
} from "../../lib/message-meta";
import { isAdminUser } from "../../lib/permissions";
import { savePendingChatRequest } from "../../lib/pending-chat-request";
import { platformStartersFor } from "./starter-utils";
import { tryWorkflowViewShortcut, syntheticSse } from "./WorkflowShortcuts";
import { useTheme } from "../../hooks/use-system-theme";
import type { AgentItem, AuthSession } from "../../types/auth";

export function useChatPageState(session: AuthSession, onLogout: () => void) {
  const mode = useTheme();
  setAdminFlag(isAdminUser(session.roles, session.user.type));
  const [userScope, setUserScope] = useState<UserScope | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  useEffect(() => {
    fetchTenantBranding().then(setBranding);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [scope, runtimeInfo] = await Promise.all([
          fetchUserScope(session),
          fetchRuntime(),
        ]);
        if (!cancelled) {
          setUserScope(scope);
          setRuntime(runtimeInfo);
          setScopeError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setScopeError(
            err instanceof Error ? err.message : "Não foi possível carregar o escopo.",
          );
        }
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    ensureToolProvider().catch((e) =>
      console.warn("[openui] toolProvider falhou:", e),
    );
  }, []);

  void buildConversationStarters;
  void runtime;

  const availableProfiles = useMemo<ProfileOption[]>(
    () =>
      (session.agents ?? [])
        .filter((a) => a.active !== false && typeof a.port === "number")
        .map((a) => ({
          id: a.profile_name ?? String(a.id),
          label: a.name ?? a.page_title ?? a.profile_name ?? String(a.id),
          description: a.description?.trim() || "",
          port: a.port,
        })),
    [session.agents],
  );

  const [activeProfile, setActiveProfile] = useState<string>(() =>
    loadActiveProfileId(),
  );

  const tenantId = session.tenant || "default";
  const lsThreadKey = (profile: string) => `waves-thread-${tenantId}-${profile}`;
  const threadKeyPrefix = `waves-${tenantId}-user-${session.user.id}::`;

  const ssThreadKey = (profile: string) => `waves-tab-thread-${tenantId}-${profile}`;
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return newThreadId();
    const profileId = loadActiveProfileId();
    const tabStored = window.sessionStorage.getItem(ssThreadKey(profileId));
    if (tabStored) return tabStored;
    const stored = window.localStorage.getItem(lsThreadKey(profileId));
    return stored || newThreadId();
  });

  setCreateTaskThreadKey(`${threadKeyPrefix}${activeThreadId}`);
  setReportThreadKey(`${threadKeyPrefix}${activeThreadId}`);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(ssThreadKey(activeProfile), activeThreadId);
      window.localStorage.setItem(lsThreadKey(activeProfile), activeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, activeThreadId, tenantId]);

  const reasoningPolicy = useMemo<"On" | "Off" | "Selectable">(() => {
    const port = availableProfiles.find((p) => p.id === activeProfile)?.port;
    const agent = (session.agents ?? []).find((a) => a.port === port);
    const raw = String(agent?.reasoning ?? "").trim().toLowerCase();
    if (raw === "on") return "On";
    if (raw === "off") return "Off";
    return "Selectable";
  }, [activeProfile, availableProfiles, session.agents]);

  const reasoningKey = (profile: string, thread: string) =>
    `waves-reasoning-${tenantId}-${profile}-${thread}`;
  const [reasoningSelection, setReasoningSelection] = useState<"low" | "medium">("low");

  useEffect(() => {
    if (reasoningPolicy === "On") { setReasoningSelection("medium"); return; }
    if (reasoningPolicy === "Off") { setReasoningSelection("low"); return; }
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(reasoningKey(activeProfile, activeThreadId));
    setReasoningSelection(v === "medium" ? "medium" : "low");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, activeThreadId, reasoningPolicy, tenantId]);

  const reasoningMode: "low" | "medium" =
    reasoningPolicy === "On" ? "medium"
    : reasoningPolicy === "Off" ? "low"
    : reasoningSelection;

  const toggleReasoning = useCallback(() => {
    setReasoningSelection((m) => {
      const next = m === "low" ? "medium" : "low";
      if (typeof window !== "undefined") {
        window.localStorage.setItem(reasoningKey(activeProfile, activeThreadId), next);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, activeThreadId, tenantId]);

  const handleProfileChange = (id: string) => {
    if (id === activeProfile) return;
    setActiveProfile(id);
    saveActiveProfileId(id);
    if (typeof window !== "undefined") {
      const tabStored = window.sessionStorage.getItem(ssThreadKey(id));
      const stored = tabStored || window.localStorage.getItem(lsThreadKey(id));
      setActiveThreadId(stored || newThreadId());
    }
  };

  useEffect(() => {
    if (availableProfiles.length === 0) return;
    if (availableProfiles.some((p) => p.id === activeProfile)) return;
    handleProfileChange(loadActiveProfileId(availableProfiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProfiles]);

  const handleNewChat = () => {
    setActiveThreadId(newThreadId());
  };

  const handleSelectThread = (fullThreadKey: string) => {
    const i = fullThreadKey.lastIndexOf("::");
    const short = i >= 0 ? fullThreadKey.slice(i + 2) : fullThreadKey;
    setActiveThreadId(short);
  };

  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: number }>).detail?.taskId;
      if (typeof id === "number") setEditTaskId(id);
    };
    window.addEventListener("waves:edit-task", h);
    return () => window.removeEventListener("waves:edit-task", h);
  }, []);

  const [createCtx, setCreateCtx] = useState<{
    workflowId: number | null;
    stageId?: number | null;
  } | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ workflowId?: number; stageId?: number }>).detail;
      const wf =
        d?.workflowId != null && Number.isFinite(Number(d.workflowId))
          ? Number(d.workflowId)
          : null;
      setCreateCtx({
        workflowId: wf,
        stageId: d?.stageId != null ? Number(d.stageId) : null,
      });
    };
    window.addEventListener("waves:create-task", h);
    return () => window.removeEventListener("waves:create-task", h);
  }, []);

  const threadAdapters = useMemo(
    () => createThreadApiAdapters(activeProfile),
    [activeProfile],
  );

  const [starters, setStarters] = useState<ProfileStarter[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fromPlatform = platformStartersFor(
      activeProfile,
      availableProfiles,
      session.agents,
    );
    if (fromPlatform.length) {
      setStarters(fromPlatform);
      return;
    }
    fetchRuntime(activeProfile).then((r) => {
      if (cancelled) return;
      setStarters(r?.defaultStarters ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, availableProfiles, session.agents]);

  const activeAgent = useMemo<AgentItem | undefined>(() => {
    const port = availableProfiles.find((p) => p.id === activeProfile)?.port;
    if (port == null) return undefined;
    return (session.agents ?? []).find((a) => a.port === port);
  }, [activeProfile, availableProfiles, session.agents]);

  setThreadGateway(
    session.accessToken
      ? { token: session.accessToken, host: activeAgent?.host, port: activeAgent?.port }
      : null,
  );
  setActiveAgentId(activeAgent?.id);

  useEffect(() => {
    const agent =
      activeAgent?.name?.trim() ||
      activeAgent?.title?.trim() ||
      activeAgent?.page_title?.trim();
    document.title = agent ? `Chat | ${agent}` : "Chat";
  }, [activeAgent]);

  const defaultWorkflowId: number | undefined = undefined;
  const persona = userScope?.persona ?? null;

  const attachmentsRef = useRef<UploadedFile[]>([]);

  const processMessage = useMemo(
    () =>
      async ({ threadId, messages, abortController }: { threadId: string; messages: Message[]; abortController: AbortController }) => {
        const attachments = attachmentsRef.current;
        attachmentsRef.current = [];

        const lastMsg = messages[messages.length - 1];

        if (lastMsg?.role === "user" && lastMsg.content != null && !attachments.length) {
          const userText =
            typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content);
          const openui = await tryWorkflowViewShortcut(userText.trim());
          if (openui) {
            saveShortcutExchange(`${threadKeyPrefix}${activeThreadId}`, userText.trim(), openui);
            return syntheticSse(openui);
          }
        }

        const threadKey = `${threadKeyPrefix}${activeThreadId}`;
        if (lastMsg?.role === "user" && lastMsg.content != null) {
          const raw =
            typeof lastMsg.content === "string"
              ? lastMsg.content
              : String(lastMsg.content);
          if (raw.trim()) savePendingChatRequest(threadKey, raw);
        }

        const payload = JSON.stringify({
          messages: openAIMessageFormat.toApi(messages),
          profile: activeProfile,
          host: activeAgent?.host,
          port: activeAgent?.port,
          agentId: activeAgent?.id,
          threadId:
            !threadId || ["", "ephemeral", "default", "shared", "main"].includes(threadId)
              ? activeThreadId
              : threadId,
          reasoningEffort: reasoningMode,
          wavesSession: {
            environment: session.environment,
            accessToken: session.accessToken,
          },
          defaultWorkflowId,
          persona,
          wantUsage: isAdmin(),
          permissions: session.effectivePermissions,
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            type: session.user.type,
          },
          roles: session.roles,
          userScope: userScope
            ? {
                agents: userScope.agents,
                fetchedAt: userScope.fetchedAt,
              }
            : null,
          attachments: attachments.length
            ? attachments.map((a) => ({
                filename: a.filename,
                mimeType: a.mimeType,
                kind: a.kind,
                size: a.size,
                url: a.url,
                path: a.path,
                contentPath: a.contentPath,
                text: a.text,
                truncated: a.truncated,
                error: a.error,
              }))
            : undefined,
        });

        return fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: abortController.signal,
        });
      },
    [
      activeProfile,
      activeThreadId,
      reasoningMode,
      session,
      userScope,
      defaultWorkflowId,
      persona,
    ],
  );

  const fileUploadRef = useRef<((files: UploadedFile[]) => void) | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const files = (e as CustomEvent<{ files: UploadedFile[] }>).detail?.files;
      if (!files?.length) return;
      attachmentsRef.current = files;
      fileUploadRef.current?.(files);
    };
    window.addEventListener("waves:file-upload-complete", h);
    return () => window.removeEventListener("waves:file-upload-complete", h);
  }, []);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleSessionExpired = useCallback(() => {
    clearSession();
    onLogout();
  }, [onLogout]);

  const handleExpire = useCallback(
    (reason: ExpireReason) => {
      setExpiredReason(reason);
      handleSessionExpired();
    },
    [handleSessionExpired],
  );

  const { showWarning, dismissWarning } = useSessionGuard({
    expiresAt: session.expiresAt,
    onExpire: handleExpire,
  });

  useEffect(() => installAuthInterceptor(() => handleExpire("expired")), [handleExpire]);

  const fullThreadKey = `${threadKeyPrefix}${activeThreadId}`;

  return {
    mode,
    userScope,
    setUserScope,
    scopeError,
    branding,
    availableProfiles,
    activeProfile,
    activeThreadId,
    threadKeyPrefix,
    fullThreadKey,
    reasoningMode,
    reasoningPolicy,
    toggleReasoning,
    handleProfileChange,
    handleNewChat,
    handleSelectThread,
    editTaskId,
    setEditTaskId,
    createCtx,
    setCreateCtx,
    threadAdapters,
    starters,
    activeAgent,
    processMessage,
    fileUploadRef,
    attachmentsRef,
    mobileNavOpen,
    setMobileNavOpen,
    handleSessionExpired,
    showWarning,
    dismissWarning,
    persona,
  };
}
