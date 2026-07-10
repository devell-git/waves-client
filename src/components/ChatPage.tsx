import "@openuidev/react-ui/components.css";

import {
  ChatProvider,
  openAIAdapter,
  openAIMessageFormat,
} from "@openuidev/react-headless";
import {
  Shell,
  ThemeProvider,
} from "@openuidev/react-ui";
import { ChatComposer } from "./ChatComposer";
import { ConversationLauncher, InputFormComposerGate } from "./ConversationLauncher";
import { UserMessageView } from "./UserMessageView";
import { NotificationBell } from "./NotificationBell";
import { FilePreviewer } from "./FilePreviewer";
import { ShareFileDialog } from "./ShareFileDialog";
import { formatScopeMeta } from "../api/user-scope";
import { SidebarUserFooter } from "./SidebarUserFooter";
import { SidebarThreadHistory } from "./SidebarThreadHistory";
import { Toaster, toast } from "sonner";
import { TaskEditModal } from "./TaskEditModal";
import { TaskCreateModal } from "./TaskCreateModal";
import { ProfileSelect } from "./ProfileSelect";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ActiveThreadContext } from "../lib/active-thread-context";
import { ThreadErrorRecovery } from "./ThreadErrorRecovery";
import { appendTaskCard } from "./chat/WorkflowShortcuts";
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
import { useChatPageState } from "./chat/useChatPageState";
import { getEnvironmentLabel } from "../config/env";
import { personaLabel } from "../lib/permissions";
import type { AuthSession } from "../types/auth";

interface ChatPageProps {
  session: AuthSession;
  onLogout: () => void;
}

export function ChatPage({ session, onLogout }: ChatPageProps) {
  const {
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
  } = useChatPageState(session, onLogout);

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
        <SidebarUserFooter
          key={activeProfile}
          user={session.user}
          onLogout={onLogout}
        />
        <ThemeProvider mode={mode}>
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
