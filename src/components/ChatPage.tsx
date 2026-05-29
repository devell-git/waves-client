import "@openuidev/react-ui/components.css";

import {
  ChatProvider,
  openAIAdapter,
  openAIMessageFormat,
  useThread,
  useThreadList,
  type Message,
} from "@openuidev/react-headless";
import {
  Shell,
  isChatEmpty,
  ThemeProvider,
} from "@openuidev/react-ui";
import { Renderer } from "@openuidev/react-lang";
// Library custom shadcn-genui (36 componentes ricos baseados em shadcn/ui)
// substitui o openuiChatLibrary built-in pra ter UI mais polida no chat.
import { shadcnChatLibrary } from "../lib/shadcn-genui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "./ChatComposer";
import { UserMessageView } from "./UserMessageView";
import type { UploadedFile } from "../api/uploads";
import {
  buildConversationStarters,
  fetchUserScope,
  formatScopeMeta,
  type UserScope,
} from "../api/user-scope";
import { fetchRuntime, type RuntimeInfo, type ProfileStarter } from "../api/runtime";
import { fetchSkills, type SkillMeta } from "../api/skills";
import { SidebarUserFooter } from "./SidebarUserFooter";
import {
  ProfileSelect,
  loadActiveProfileId,
  saveActiveProfileId,
} from "./ProfileSelect";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { createThreadApiAdapters, newThreadId } from "../api/threads";

/**
 * Ícone padrão pra starter quando o item não traz um próprio.
 * Mapeia por keyword no displayText pra dar contexto visual.
 */
function pickIcon(displayText: string): string {
  const t = displayText.toLowerCase();
  if (/cnpj|empresa|due diligence/.test(t)) return "🏢";
  if (/cpf|pessoa/.test(t)) return "👤";
  if (/dashboard|gráfico|chart|kpi/.test(t)) return "📊";
  if (/kanban|workflow|board/.test(t)) return "📋";
  if (/funil|funnel/.test(t)) return "🔻";
  if (/agenda|appointment|consulta/.test(t)) return "📅";
  if (/skill|ferramenta|tool/.test(t)) return "🧰";
  if (/relatório|report/.test(t)) return "📄";
  return "✨";
}
import { getEnvironmentLabel } from "../config/env";
import { personaLabel } from "../lib/permissions";
import { useTheme } from "../hooks/use-system-theme";
import { usePendingSpecialistJobs } from "../hooks/use-pending-specialist-jobs";
import type { AuthSession } from "../types/auth";

interface ChatPageProps {
  session: AuthSession;
  onLogout: () => void;
}

// ─── Render do assistant message com GenUI (Renderer + shadcnChatLibrary) ───
// Substitui o GenUIAssistantMessage interno que o FullScreen usava via
// withChatProvider. Renderiza openui-lang direto via Renderer.
//
// FALLBACK pra texto puro: a SOUL REGRA 0 permite que respostas a
// saudações ("oi", "obrigado", "ok") sejam texto cru — sem `root =`,
// sem `Card(...)`. O Renderer do openuidev exige openui-lang e renderiza
// nada pra texto puro, então detectamos plain text e renderizamos numa
// bolha de chat simples.
const OPENUI_PATTERN = /\b(root\s*=|Card\s*\(|CardHeader\s*\(|TextContent\s*\(|Table\s*\(|TagBlock\s*\(|Alert\s*\(|FollowUpItem\s*\(|(?:Pie|Bar|Line)Chart\s*\(|ListBlock\s*\(|Accordion\s*\()/;

function GenUIAssistantMessage({ message }: { message: { content?: string } }) {
  const content = typeof message.content === "string" ? message.content : "";
  const processMessage = useThread((s) => s.processMessage);
  const isStreaming = useThread((s) => s.isRunning);
  if (!content) return null;

  // Texto puro (sem construções openui-lang) → bolha de chat simples
  if (!OPENUI_PATTERN.test(content)) {
    return (
      <div className="assistant-plain-text" style={{
        padding: "0.75rem 1rem",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {content}
      </div>
    );
  }

  return (
    <Renderer
      response={content}
      library={shadcnChatLibrary}
      isStreaming={isStreaming}
      onAction={(event) => {
        if (event.type === "continue_conversation") {
          const contentPart = event.humanFriendlyMessage
            ? `<content>${event.humanFriendlyMessage}</content>`
            : "";
          const ctx: unknown[] = [`User clicked: ${event.humanFriendlyMessage ?? ""}`];
          if (event.formState) ctx.push(event.formState);
          processMessage({
            role: "user",
            content: `${contentPart}<context>${JSON.stringify(ctx)}</context>`,
          });
          return;
        }
        // open_url: o Button(action=open_url) emite isso. Abre em nova aba só
        // pra URLs seguras — same-origin (/api/...) ou hosts confiáveis (Waves).
        // Bloqueia javascript:/data:/externos não-allowlisted (proteção contra
        // openui-lang malicioso vindo de prompt-injection num doc enviado).
        if (event.type === "open_url") {
          const rawUrl = event.params?.url;
          const url = typeof rawUrl === "string" ? rawUrl : "";
          const safe =
            /^\/[^/]/.test(url) ||
            /^https:\/\/([a-z0-9-]+\.)*devell\.com\.br(\/|$)/i.test(url);
          if (safe) {
            window.open(url, "_blank", "noopener,noreferrer");
          } else if (url) {
            console.warn("[openui] open_url bloqueado (fora da allowlist):", url);
          }
        }
      }}
    />
  );
}

// Welcome interno: composer central + starters discretos abaixo. Renderiza
// apenas quando o chat está vazio (sem mensagens). O `Shell.WelcomeScreen`
// quando recebe `starters` + título cria layout: título → composer central →
// starters em pílulas embaixo (variant "short").
// Passamos `children` pra Shell.WelcomeScreen DE PROPÓSITO: assim ela NÃO
// adiciona a classe `--with-composer`, e a regra de CSS da lib que esconde o
// composer da thread no estado vazio não dispara — ou seja, nosso ChatComposer
// (único, com botão "+") fica visível tanto na welcome quanto na conversa.
// Renderizamos título + starters aqui; o input fica no ChatComposer embaixo.
function WelcomeArea({ starters }: { starters: ProfileStarter[] }) {
  const messages = useThread((s) => s.messages);
  const isLoadingMessages = useThread((s) => s.isLoadingMessages);
  const processMessage = useThread((s) => s.processMessage);
  const isRunning = useThread((s) => s.isRunning);
  if (!isChatEmpty({ isLoadingMessages, messages })) return null;

  return (
    <Shell.WelcomeScreen>
      <div className="waves-welcome">
        <h2 className="waves-welcome__title">Como posso ajudar?</h2>
        <p className="waves-welcome__desc">
          Escolha uma opção, digite sua mensagem ou anexe um arquivo no “+”.
        </p>
        {starters.length > 0 && (
          <div className="waves-welcome__starters">
            {starters.map((s, i) => (
              <button
                key={`${s.displayText}-${i}`}
                type="button"
                className="waves-welcome__starter"
                disabled={isRunning}
                onClick={() => processMessage({ role: "user", content: s.prompt })}
              >
                <span aria-hidden>{pickIcon(s.displayText)}</span>
                <span>{s.displayText}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Shell.WelcomeScreen>
  );
}

// Detecta jobs de specialists pendentes nas mensagens do assistant e
// auto-polla `/api/specialist-jobs/:id/rendered`. Quando o sub-agent
// termina, injeta a resposta renderizada (openui-lang) na conversa sem
// precisar do user clicar. Componente sem render — só side-effects.
function SpecialistJobPoller() {
  const messages = useThread((s) => s.messages);
  const appendMessages = useThread((s) => s.appendMessages);
  usePendingSpecialistJobs({ messages, appendMessages });
  return null;
}

// Auto-sincroniza o threadId selecionado quando o ChatProvider monta —
// chama selectThread após fetchThreadList carregar pela primeira vez.
function ThreadSelector({ targetThreadId }: { targetThreadId: string }) {
  const selectedId = useThreadList((s) => s.selectedThreadId);
  const selectThread = useThreadList((s) => s.selectThread);
  const threads = useThreadList((s) => s.threads);
  const isLoading = useThreadList((s) => s.isLoadingThreads);

  useEffect(() => {
    if (isLoading) return;
    if (selectedId === targetThreadId) return;
    // só seleciona se a thread já existe na lista — senão deixa o user iniciar
    // uma conversa nova (que vai criar a thread ao mandar a primeira message)
    if (threads.some((t) => t.id === targetThreadId)) {
      selectThread(targetThreadId);
    }
  }, [isLoading, selectedId, targetThreadId, threads, selectThread]);

  return null;
}

export function ChatPage({ session, onLogout }: ChatPageProps) {
  const mode = useTheme();
  const [userScope, setUserScope] = useState<UserScope | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [scope, skillsList, runtimeInfo] = await Promise.all([
          fetchUserScope(session),
          fetchSkills(),
          fetchRuntime(),
        ]);
        if (!cancelled) {
          setUserScope(scope);
          setSkills(skillsList);
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

  void buildConversationStarters;
  void runtime;
  void skills;

  // Profile selecionado (negative-media | map). Lista fixa por enquanto.
  const [activeProfile, setActiveProfile] = useState<string>(() =>
    loadActiveProfileId(),
  );

  // Thread atual (conversa). Persistida por profile em localStorage.
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return newThreadId();
    const stored = window.localStorage.getItem(`waves-thread-${loadActiveProfileId()}`);
    return stored || newThreadId();
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`waves-thread-${activeProfile}`, activeThreadId);
    }
  }, [activeProfile, activeThreadId]);

  const handleProfileChange = (id: string) => {
    if (id === activeProfile) return;
    setActiveProfile(id);
    saveActiveProfileId(id);
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(`waves-thread-${id}`);
      setActiveThreadId(stored || newThreadId());
    }
  };

  // Adapters do ChatProvider — recalcula quando profile muda
  const threadAdapters = useMemo(
    () => createThreadApiAdapters(activeProfile),
    [activeProfile],
  );

  // Starters do profile ativo (vêm de /api/runtime?profile=X)
  const [starters, setStarters] = useState<ProfileStarter[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchRuntime(activeProfile).then((r) => {
      if (cancelled) return;
      setStarters(r?.defaultStarters ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfile]);

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
        // Retry transparente em erros de rede iniciais (load failed, network
        // error) — comum em mobile que troca de WiFi/cellular ou suspende a
        // aba. Só retry se o fetch falhou ANTES de retornar a Response —
        // depois disso o stream é responsabilidade do openuidev. Se o user
        // abortou, propaga sem retry.
        const payload = JSON.stringify({
          messages: openAIMessageFormat.toApi(messages),
          profile: activeProfile,
          // Continuidade de conversa: o runtime às vezes passa threadId vazio/
          // "default" em conversas novas → o backend cairia num session efêmero
          // (sem histórico). Usa o activeThreadId persistido (por profile) como
          // fallback estável pra o Hermes manter a memória do CNPJ etc.
          threadId:
            !threadId || ["", "ephemeral", "default", "shared", "main"].includes(threadId)
              ? activeThreadId
              : threadId,
          wavesSession: {
            environment: session.environment,
            accessToken: session.accessToken,
          },
          defaultWorkflowId,
          persona,
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
                text: a.text,
                truncated: a.truncated,
                error: a.error,
              }))
            : undefined,
        });

        const MAX_ATTEMPTS = 3;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            return await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              signal: abortController.signal,
            });
          } catch (err) {
            // User abortou (clicou Stop) → propaga sem retry
            if (abortController.signal.aborted) throw err;
            if (err instanceof DOMException && err.name === "AbortError") throw err;
            lastErr = err;
            // Backoff: 400ms, 800ms (3 tentativas no total)
            if (attempt < MAX_ATTEMPTS - 1) {
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
          }
        }
        throw lastErr ?? new Error("fetch falhou após retries");
      },
    [
      activeProfile,
      activeThreadId,
      session,
      userScope,
      defaultWorkflowId,
      persona,
    ],
  );

  return (
    <div className="chat-shell">
      <header className="chat-shell-header">
        <div className="chat-shell-brand">
          <img
            src="https://devell.com.br/medias/logo-waves-azul.png"
            alt="Waves"
            className="chat-shell-logo chat-shell-logo-light"
          />
          <img
            src="https://devell.com.br/medias/logo-waves-branco.png"
            alt="Waves"
            className="chat-shell-logo chat-shell-logo-dark"
          />
          <span className="chat-shell-meta" hidden>
            {session.user.name}
            {session.user.type ? ` · ${session.user.type}` : ""}
            {" · "}
            {getEnvironmentLabel()}
            {persona && <> · {personaLabel(persona)}</>}
            {userScope && <> · {formatScopeMeta(userScope)}</>}
            {skills.length > 0 && <> · {skills.length} skills (Steve)</>}
          </span>
          {scopeError && (
            <span className="chat-shell-meta" style={{ color: "var(--color-error, #c00)" }}>
              {scopeError}
            </span>
          )}
        </div>
        <ProfileSelect activeId={activeProfile} onChange={handleProfileChange} />
        <div className="chat-shell-header-actions" />
      </header>

      <div className="chat-shell-body">
        <SidebarUserFooter user={session.user} onLogout={onLogout} />
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
            <ThreadSelector targetThreadId={activeThreadId} />
            <SpecialistJobPoller />
            <Shell.Container
              logoUrl={mode === "dark" ? "/waves_white.png" : "/waves_blue.png"}
              agentName="Agent"
            >
              <Shell.SidebarContainer>
                <Shell.SidebarHeader />
                {/* SidebarThreadHistory desativado — UX confusa enquanto a
                    persistência por thread não está finalizada. */}
                <Shell.SidebarContent />
              </Shell.SidebarContainer>
              <Shell.ThreadContainer>
                <WelcomeArea starters={starters} />
                <Shell.ScrollArea>
                  <Shell.Messages
                    loader={<ThinkingIndicator />}
                    assistantMessage={GenUIAssistantMessage}
                    userMessage={UserMessageView}
                  />
                </Shell.ScrollArea>
                <ChatComposer attachmentsRef={attachmentsRef} />
              </Shell.ThreadContainer>
            </Shell.Container>
          </ChatProvider>
        </ThemeProvider>
      </div>
    </div>
  );
}
