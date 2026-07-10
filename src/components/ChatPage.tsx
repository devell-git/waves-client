import "@openuidev/react-ui/components.css";

import {
  ChatProvider,
  openAIAdapter,
  openAIMessageFormat,
  type Message,
} from "@openuidev/react-headless";
import {
  Shell,
  ThemeProvider,
} from "@openuidev/react-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import { ConversationLauncher, InputFormComposerGate } from "./ConversationLauncher";
import { UserMessageView } from "./UserMessageView";
import { NotificationBell } from "./NotificationBell";
import { FilePreviewer } from "./FilePreviewer";
import { ShareFileDialog } from "./ShareFileDialog";
import type { UploadedFile } from "../api/uploads";
import {
  buildConversationStarters,
  fetchUserScope,
  formatScopeMeta,
  type UserScope,
} from "../api/user-scope";
import { fetchRuntime, type RuntimeInfo, type ProfileStarter } from "../api/runtime";
import { SidebarUserFooter } from "./SidebarUserFooter";
import { SidebarThreadHistory } from "./SidebarThreadHistory";
import { Toaster, toast } from "sonner";
import { TaskEditModal } from "./TaskEditModal";
import { TaskCreateModal } from "./TaskCreateModal";
import {
  ProfileSelect,
  type ProfileOption,
  loadActiveProfileId,
  saveActiveProfileId,
} from "./ProfileSelect";
import { ThinkingIndicator } from "./ThinkingIndicator";
import {
  createThreadApiAdapters,
  newThreadId,
  setThreadGateway,
} from "../api/threads";
import { ActiveThreadContext } from "../lib/active-thread-context";
import { ThreadErrorRecovery } from "./ThreadErrorRecovery";
import { clearSession } from "../lib/session";
import {
  useSessionGuard,
  setExpiredReason,
  type ExpireReason,
} from "../lib/session-guard";
import { installAuthInterceptor } from "../lib/fetch-interceptor";
import { fetchTenantBranding, type TenantBranding } from "../lib/tenant";
import {
  setCreateTaskThreadKey,
} from "../lib/createtask-consumed";
import { setReportThreadKey } from "../lib/report-cache";
import { saveShortcutExchange } from "../lib/shortcut-history";
import {
  ensureToolProvider,
  setActiveAgentId,
} from "../lib/openui-tools";
import {
  setAdminFlag,
  isAdmin,
} from "../lib/message-meta";
import { isAdminUser } from "../lib/permissions";
import { savePendingChatRequest } from "../lib/pending-chat-request";

import { platformStartersFor } from "./chat/starter-utils";
import { tryWorkflowViewShortcut, syntheticSse, appendTaskCard } from "./chat/WorkflowShortcuts";
import { WelcomeArea } from "./chat/WelcomeArea";
import { GenUIAssistantMessage } from "./chat/GenUIAssistantMessage";
import {
  FileUploadBridge,
  ThreadSelector,
  RunTracker,
  BackgroundJobWatcher,
  ScrollAnchorOnOpen,
  BackgroundRunWatcher,
  ChatAppendListener,
} from "./chat/ChatBridges";
import { ThreadRestorer } from "./chat/ThreadRestorer";
import { getEnvironmentLabel } from "../config/env";
import { personaLabel } from "../lib/permissions";
import { useTheme } from "../hooks/use-system-theme";
import type { AgentItem, AuthSession } from "../types/auth";

interface ChatPageProps {
  session: AuthSession;
  onLogout: () => void;
}


export function ChatPage({ session, onLogout }: ChatPageProps) {
  const mode = useTheme();
  // Flag de admin (vem no escopo do login) — habilita o badge de tokens.
  setAdminFlag(isAdminUser(session.roles, session.user.type));
  const [userScope, setUserScope] = useState<UserScope | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  // Logos do tenant (do /api/tenant, resolvido por host). SEM fallback: ou o
  // tenant tem logo, ou não renderiza nada — nunca um logo hardcoded de outro.
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

  // Monta o toolProvider (runtime EXECUTE do OpenUI) uma vez — Query()/Mutation()
  // resolvem direto pelas tools nativas da Waves, sem passar pelo LLM.
  useEffect(() => {
    ensureToolProvider().catch((e) =>
      console.warn("[openui] toolProvider falhou:", e),
    );
  }, []);

  void buildConversationStarters;
  void runtime;

  // Select 100% do LOGIN: cada usuário vê o conjunto de agents que a Waves
  // retornou. Apps desacopladas — NÃO há registry/lista no servidor. O id é o
  // profile_name; o gateway alvo (host+port, do próprio agent) viaja no body do
  // /api/chat. Rótulo = nome do login.
  const availableProfiles = useMemo<ProfileOption[]>(
    () =>
      (session.agents ?? [])
        .filter((a) => a.active !== false && typeof a.port === "number")
        .map((a) => ({
          id: a.profile_name ?? String(a.id),
          label: a.name ?? a.page_title ?? a.profile_name ?? String(a.id),
          // Descrição REAL do assistente (cadastro Waves) — não o nome+porta
          // técnico. Snippet + tooltip completo no ProfileSelect. SEM fallback:
          // sem description, fica só o nome (o label) — sem 2ª linha. (#836)
          description: a.description?.trim() || "",
          port: a.port,
        })),
    [session.agents],
  );

  // Profile selecionado. Validado contra os disponíveis assim que o login resolve.
  const [activeProfile, setActiveProfile] = useState<string>(() =>
    loadActiveProfileId(),
  );

  // Tenant da sessão (resolvido por host no login). Vincula as threads pra não
  // misturar conversas de tenants diferentes com o mesmo user-id — tanto no
  // ponteiro em localStorage quanto na key da sessão do gateway.
  const tenantId = session.tenant || "default";
  const lsThreadKey = (profile: string) => `waves-thread-${tenantId}-${profile}`;
  const threadKeyPrefix = `waves-${tenantId}-user-${session.user.id}::`;

  // Thread atual (conversa). Prioridade: sessionStorage (por aba) > localStorage (entre abas).
  // sessionStorage isola cada aba — duas abas do mesmo perfil NÃO interferem uma na outra.
  // localStorage fica como backup pra restaurar ao reabrir a aba.
  const ssThreadKey = (profile: string) => `waves-tab-thread-${tenantId}-${profile}`;
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return newThreadId();
    const profileId = loadActiveProfileId();
    // 1. sessionStorage da aba atual (isolado por aba)
    const tabStored = window.sessionStorage.getItem(ssThreadKey(profileId));
    if (tabStored) return tabStored;
    // 2. localStorage (compartilhado — fallback ao abrir aba nova)
    const stored = window.localStorage.getItem(lsThreadKey(profileId));
    return stored || newThreadId();
  });

  // Escopo do dedupe do auto-open de tarefa = thread ativa. Gravado no render
  // (mesmo padrão do kanban-context) pra já estar setado quando o efeito de um
  // CreateTaskTrigger filho rodar (efeitos de filho rodam antes do do pai).
  setCreateTaskThreadKey(`${threadKeyPrefix}${activeThreadId}`);
  setReportThreadKey(`${threadKeyPrefix}${activeThreadId}`);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Persiste em AMBOS: sessionStorage (isolado por aba) + localStorage (backup)
      window.sessionStorage.setItem(ssThreadKey(activeProfile), activeThreadId);
      window.localStorage.setItem(lsThreadKey(activeProfile), activeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, activeThreadId, tenantId]);

  // Política de reasoning do AGENTE ativo (cadastrada na Waves, vem no login):
  //  On → sempre "medium" e SEM botão; Off → sempre "low" e SEM botão;
  //  Selectable → mostra botão, default "low". Default Selectable se não vier.
  const reasoningPolicy = useMemo<"On" | "Off" | "Selectable">(() => {
    const port = availableProfiles.find((p) => p.id === activeProfile)?.port;
    const agent = (session.agents ?? []).find((a) => a.port === port);
    const raw = String(agent?.reasoning ?? "").trim().toLowerCase();
    if (raw === "on") return "On";
    if (raw === "off") return "Off";
    return "Selectable";
  }, [activeProfile, availableProfiles, session.agents]);

  // Modo de reasoning EFETIVO ("low" ⚡ rápido | "medium" 🧠 aprofundado), vira
  // o header X-Hermes-Reasoning-Effort. Guardado POR THREAD (volta igual ao
  // reabrir a conversa). On/Off forçam o valor; Selectable usa o salvo (default low).
  const reasoningKey = (profile: string, thread: string) =>
    `waves-reasoning-${tenantId}-${profile}-${thread}`;
  const [reasoningSelection, setReasoningSelection] = useState<"low" | "medium">("low");

  // Hidrata a seleção salva da thread atual (e reage à política do agente).
  useEffect(() => {
    if (reasoningPolicy === "On") { setReasoningSelection("medium"); return; }
    if (reasoningPolicy === "Off") { setReasoningSelection("low"); return; }
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(reasoningKey(activeProfile, activeThreadId));
    setReasoningSelection(v === "medium" ? "medium" : "low");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, activeThreadId, reasoningPolicy, tenantId]);

  // O que de fato é enviado (política sobrepõe a seleção).
  const reasoningMode: "low" | "medium" =
    reasoningPolicy === "On" ? "medium"
    : reasoningPolicy === "Off" ? "low"
    : reasoningSelection;

  // Toggle (só relevante em Selectable): alterna e persiste NA THREAD.
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
      // Prioridade: sessionStorage (aba) > localStorage (backup)
      const tabStored = window.sessionStorage.getItem(ssThreadKey(id));
      const stored = tabStored || window.localStorage.getItem(lsThreadKey(id));
      setActiveThreadId(stored || newThreadId());
    }
  };

  // Quando os profiles do login chegam, garante que o ativo é um deles.
  // Se o salvo não estiver disponível pro usuário, troca pro primeiro.
  useEffect(() => {
    if (availableProfiles.length === 0) return;
    if (availableProfiles.some((p) => p.id === activeProfile)) return;
    handleProfileChange(loadActiveProfileId(availableProfiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProfiles]);

  // "Nova conversa": novo threadId → nova sessão no gateway (contexto limpo).
  // O setActiveThreadId persiste em localStorage (effect abaixo); a sidebar
  // limpa as mensagens da UI.
  const handleNewChat = () => {
    setActiveThreadId(newThreadId());
  };

  // Selecionar uma conversa da lista: a lista traz a CHAVE COMPLETA
  // (`waves-user-<id>::<thread>`); guardamos a parte CURTA no activeThreadId
  // (é o que o processMessage manda; o gateway re-prefixa). O ThreadRestorer
  // (keyed na chave completa derivada) hidrata as mensagens.
  const handleSelectThread = (fullThreadKey: string) => {
    const i = fullThreadKey.lastIndexOf("::");
    const short = i >= 0 ? fullThreadKey.slice(i + 2) : fullThreadKey;
    setActiveThreadId(short);
  };

  // Modal de edição de task (caminho B): o onAction dispara "waves:edit-task"
  // com o id; aqui abrimos o modal nativo (GET dos dados reais + PUT).
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: number }>).detail?.taskId;
      if (typeof id === "number") setEditTaskId(id);
    };
    window.addEventListener("waves:edit-task", h);
    return () => window.removeEventListener("waves:edit-task", h);
  }, []);

  // Modal de criação de task (caminho B): o botão "+ Nova" do Kanban (ou a ação
  // create_task) dispara "waves:create-task" com {workflowId, stageId}.
  const [createCtx, setCreateCtx] = useState<{
    workflowId: number | null;
    stageId?: number | null;
  } | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ workflowId?: number; stageId?: number }>).detail;
      // Abre SEMPRE — sem workflow o modal mostra o seletor de workflow.
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

  // Adapters do ChatProvider — recalcula quando profile muda
  const threadAdapters = useMemo(
    () => createThreadApiAdapters(activeProfile),
    [activeProfile],
  );

  // Starters do profile ativo. PREFERÊNCIA: os cadastrados na PLATAFORMA
  // (login → agent.starters, casados por porta). FALLBACK: os do runtime
  // (hardcoded no server) enquanto a plataforma não tiver cadastro.
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

  // Agente do login casado ao profile ativo (por porta) → page_title/subtitle.
  const activeAgent = useMemo<AgentItem | undefined>(() => {
    const port = availableProfiles.find((p) => p.id === activeProfile)?.port;
    if (port == null) return undefined;
    return (session.agents ?? []).find((a) => a.port === port);
  }, [activeProfile, availableProfiles, session.agents]);

  // Apps desacopladas: o histórico (threads) é lido do gateway por HTTP. O
  // cliente de threads precisa do Bearer do usuário + host/port do agent ativo
  // pra o server rotear. Setamos no PRÓPRIO render (não em effect) pra que o
  // primeiro fetch de histórico — disparado por effect do provider — já tenha
  // auth; é idempotente (só atualiza um singleton de config no módulo).
  setThreadGateway(
    session.accessToken
      ? { token: session.accessToken, host: activeAgent?.host, port: activeAgent?.port }
      : null,
  );
  // Agente ativo → X-Agent-Id nas chamadas do runtime OpenUI (proxy anexa ?agent_id=
  // nas rotas de workflow/task). Idempotente, mesmo padrão do setThreadGateway acima.
  setActiveAgentId(activeAgent?.id);

  // Aba interna (só temos a página de chat) → "Chat | <nome do agente>".
  // Nome do agente vem do cadastro (page_title/title/name). Sem agente → "Chat".
  // (A tela de login usa o nome do tenant — definido no App.tsx.)
  useEffect(() => {
    // Nome do agente = campo "Nome" (name) cadastrado na Waves (ex.:
    // "BioShield - Steve"); fallback título/page_title só se name faltar.
    const agent =
      activeAgent?.name?.trim() ||
      activeAgent?.title?.trim() ||
      activeAgent?.page_title?.trim();
    document.title = agent ? `Chat | ${agent}` : "Chat";
  }, [activeAgent]);

  const defaultWorkflowId: number | undefined = undefined;
  const persona = userScope?.persona ?? null;

  // Anexos enviados no composer ANTES de disparar a mensagem. Lido e limpo
  // aqui pra anexar o texto extraído no body (canal lateral — fora da bolha).
  const attachmentsRef = useRef<UploadedFile[]>([]);

  const processMessage = useMemo(
    () =>
      async ({ threadId, messages, abortController }: { threadId: string; messages: Message[]; abortController: AbortController }) => {
        // Captura e limpa os anexos pendentes (sobrevive a retries do payload).
        const attachments = attachmentsRef.current;
        attachmentsRef.current = [];

        const lastMsg = messages[messages.length - 1];

        // Atalho determinístico de kanban: "abrir kanban do AP X" → renderiza o
        // board SEM LLM (resolve workflow_id client-side, devolve SSE sintético).
        // Cobre composer E followUp (ambos passam por este transport). Só dispara
        // quando NÃO há anexos; se não resolver, cai no /api/chat normal abaixo.
        if (lastMsg?.role === "user" && lastMsg.content != null && !attachments.length) {
          const userText =
            typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content);
          const openui = await tryWorkflowViewShortcut(userText.trim());
          if (openui) {
            // Persiste local pra sobreviver ao reload (o atalho não passa pelo
            // gateway, então não entra no state.db; o ThreadRestorer mescla).
            saveShortcutExchange(`${threadKeyPrefix}${activeThreadId}`, userText.trim(), openui);
            return syntheticSse(openui);
          }
        }

        // Guarda a requisição exata (follow-up, composer, etc.) para retomar após
        // queda de rede — ThreadErrorRecovery lê e chama processMessage de novo.
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
          // Gateway alvo vem do agente do LOGIN (host+port). O servidor roteia
          // por isso (sem lista hardcoded) e autentica com o token do usuário.
          host: activeAgent?.host,
          port: activeAgent?.port,
          // agent_id (do login) → o server manda X-Hermes-Agent-Id pro gateway, que
          // grava na web-session; as MCP tools de workflow/task anexam ?agent_id=.
          agentId: activeAgent?.id,
          // Continuidade de conversa: o runtime às vezes passa threadId vazio/
          // "default" em conversas novas → o backend cairia num session efêmero
          // (sem histórico). Usa o activeThreadId persistido (por profile) como
          // fallback estável pra o Hermes manter a memória do CNPJ etc.
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
          // Só pede usage de tokens quando admin (o badge é admin-only) — evita
          // o custo de latência do include_usage pra usuários comuns.
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
          // Anexos: o servidor injeta o texto extraído na última mensagem do
          // user antes de mandar pro LLM/Hermes.
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

        // Sem retry automático no POST: troca de rede mata o fetch em voo e
        // repetir o mesmo body não revalida login/thread. Recuperação explícita
        // em ThreadErrorRecovery (verifyApiSession + getThreadMessages).
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

  // FileUpload openui component: armazena arquivos e despacha via global ref.
  // O listener real (que chama processMessage do useThread) é registrado
  // dentro do ChatProvider por _FileUploadBridge abaixo.
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

  // Drawer mobile da sidebar de conversas (#2). Fecha ao trocar de thread.
  // (FileUploadBridge defined below, inside return, uses useThread inside ChatProvider)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleSessionExpired = useCallback(() => {
    clearSession();
    onLogout();
  }, [onLogout]);

  // #790 Fase 1 — encerra a sessão registrando o MOTIVO (mostrado na LoginPage).
  const handleExpire = useCallback(
    (reason: ExpireReason) => {
      setExpiredReason(reason);
      handleSessionExpired();
    },
    [handleSessionExpired],
  );

  // #790 — guarda inatividade (30min) + expiração absoluta + aviso ~5min antes.
  const { showWarning, dismissWarning } = useSessionGuard({
    expiresAt: session.expiresAt,
    onExpire: handleExpire,
  });

  // #790 — 401 no proxy de auth /api/waves/* (token morto) → logout + login.
  // Conservador: só 401 (não 403 de permissão) e só no proxy de auth.
  useEffect(() => installAuthInterceptor(() => handleExpire("expired")), [handleExpire]);

  const fullThreadKey = `${threadKeyPrefix}${activeThreadId}`;

  return (
    <div className="chat-shell">
      {showWarning && (
        <div className="session-warning" role="alert">
          <span>
            ⚠️ Sua sessão vai expirar em alguns minutos. Salve seu trabalho — você
            precisará entrar novamente.
          </span>
          <button type="button" onClick={dismissWarning} aria-label="Dispensar aviso">
            ✕
          </button>
        </div>
      )}
      <header className="chat-shell-header">
        <button
          type="button"
          className="chat-shell-hamburger"
          aria-label="Abrir conversas"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-expanded={mobileNavOpen}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className="chat-shell-brand">
          {branding?.logo_dark && (
            <img
              src={branding.logo_dark}
              alt={branding.tenant}
              className="chat-shell-logo chat-shell-logo-light"
            />
          )}
          {branding?.logo_white && (
            <img
              src={branding.logo_white}
              alt={branding.tenant}
              className="chat-shell-logo chat-shell-logo-dark"
            />
          )}
          <span className="chat-shell-meta" hidden>
            {session.user.name}
            {session.user.type ? ` · ${session.user.type}` : ""}
            {" · "}
            {getEnvironmentLabel()}
            {persona && <> · {personaLabel(persona)}</>}
            {userScope && <> · {formatScopeMeta(userScope)}</>}
          </span>
          {scopeError && (
            <span className="chat-shell-meta" style={{ color: "var(--color-error, #c00)" }}>
              {scopeError}
            </span>
          )}
        </div>
        <ProfileSelect
          profiles={availableProfiles}
          activeId={activeProfile}
          onChange={handleProfileChange}
        />
        <div className="chat-shell-header-actions" />
      </header>

      <div className={`chat-shell-body${mobileNavOpen ? " nav-open" : ""}`}>
        {/* key=activeProfile: a sidebar da lib remonta ao trocar profile (o
            ChatProvider abaixo tem a mesma key). Sem remontar aqui, o footer
            portalizado ficava preso à sidebar antiga (destruída) e sumia. */}
        <SidebarUserFooter
          key={activeProfile}
          user={session.user}
          onLogout={onLogout}
        />
        <ThemeProvider mode={mode}>
          {/* key força remount quando profile muda (adapters/state limpos) */}
          <ChatProvider
            key={activeProfile}
            processMessage={processMessage}
            streamProtocol={openAIAdapter()}
            messageFormat={openAIMessageFormat}
            fetchThreadList={threadAdapters.fetchThreadList}
            loadThread={threadAdapters.loadThread}
            updateThread={threadAdapters.updateThread}
            deleteThread={threadAdapters.deleteThread}
          >
            <FileUploadBridge bridgeRef={fileUploadRef} />
            <ThreadSelector targetThreadId={activeThreadId} />
            <ThreadRestorer profileId={activeProfile} fullThreadKey={fullThreadKey} />
            <ChatAppendListener />
            <RunTracker activeThreadId={activeThreadId} />
            <ScrollAnchorOnOpen threadKey={fullThreadKey} />
            <BackgroundJobWatcher />
            <BackgroundRunWatcher
              profileId={activeProfile}
              threadKeyPrefix={threadKeyPrefix}
              activeThreadId={activeThreadId}
            />
            <ShareFileDialog profile={activeProfile} userId={String(session.user.id)} />
            <NotificationBell profile={activeProfile} userId={String(session.user.id)} />
            <FilePreviewer profile={activeProfile} />
            {mobileNavOpen && (
              <div
                className="chat-shell-nav-overlay"
                onClick={() => setMobileNavOpen(false)}
                aria-hidden="true"
              />
            )}
            <ActiveThreadContext.Provider value={activeThreadId}>
            <Shell.Container
              logoUrl={(mode === "dark" ? branding?.logo_white : branding?.logo_dark) ?? ""}
              agentName="Agent"
            >
              <Shell.SidebarContainer>
                <Shell.SidebarHeader />
                <SidebarThreadHistory
                  profileId={activeProfile}
                  onNewChat={() => { handleNewChat(); setMobileNavOpen(false); }}
                  onSelectThread={(k) => { handleSelectThread(k); setMobileNavOpen(false); }}
                  activeThreadId={activeThreadId}
                  threadKeyPrefix={threadKeyPrefix}
                />
                <Shell.SidebarContent />
              </Shell.SidebarContainer>
              <Shell.ThreadContainer>
                <WelcomeArea
                  starters={starters}
                  title={activeAgent?.page_title}
                  subtitle={activeAgent?.page_subtitle}
                  agent={activeAgent}
                />
                <Shell.ScrollArea scrollVariant="always">
                  <ConversationLauncher agent={activeAgent} />
                  <Shell.Messages
                    loader={<ThinkingIndicator />}
                    assistantMessage={GenUIAssistantMessage}
                    userMessage={UserMessageView}
                  />
                  <ThreadErrorRecovery
                    session={session}
                    profileId={activeProfile}
                    fullThreadKey={fullThreadKey}
                    onSessionExpired={handleSessionExpired}
                    onScopeRefresh={setUserScope}
                  />
                </Shell.ScrollArea>
                <InputFormComposerGate agent={activeAgent}>
                  <ChatComposer
                    attachmentsRef={attachmentsRef}
                    reasoningMode={reasoningMode}
                    onToggleReasoning={
                      reasoningPolicy === "Selectable" ? toggleReasoning : undefined
                    }
                  />
                </InputFormComposerGate>
              </Shell.ThreadContainer>
            </Shell.Container>
            </ActiveThreadContext.Provider>
          </ChatProvider>
        </ThemeProvider>
      </div>
      <TaskEditModal
        taskId={editTaskId}
        onClose={() => setEditTaskId(null)}
        onSaved={(r) => {
          toast.success("Tarefa atualizada");
          appendTaskCard("updated", r);
        }}
      />
      <TaskCreateModal
        open={createCtx != null}
        workflowId={createCtx?.workflowId ?? null}
        initialStageId={createCtx?.stageId ?? null}
        onClose={() => setCreateCtx(null)}
        onCreated={(r) => {
          toast.success(r.id ? `Tarefa #${r.id} criada` : "Tarefa criada");
          appendTaskCard("created", r);
        }}
      />
      <Toaster richColors position="top-center" />
    </div>
  );
}
