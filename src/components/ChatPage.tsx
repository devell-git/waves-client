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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SidebarThreadHistory } from "./SidebarThreadHistory";
import { Toaster, toast } from "sonner";
import { TaskEditModal } from "./TaskEditModal";
import { TaskCreateModal } from "./TaskCreateModal";
import {
  ProfileSelect,
  loadActiveProfileId,
  saveActiveProfileId,
} from "./ProfileSelect";
import { ThinkingIndicator } from "./ThinkingIndicator";
import {
  createThreadApiAdapters,
  newThreadId,
  getThreadMessages,
  toOpenUIMessage,
} from "../api/threads";
import { JobProgressCard, parseCheckJob } from "./JobProgressCard";
import { ThreadErrorRecovery } from "./ThreadErrorRecovery";
import { clearSession } from "../lib/session";
import { getKanbanCtx } from "../lib/kanban-context";
import { savePendingChatRequest } from "../lib/pending-chat-request";

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

// Diretiva `open_create_task: {"workflow_id":..,"stage_id":..}` — o agente emite
// só isso quando o user pede pra criar tarefa; abrimos o modal nativo direto.
function parseCreateTaskDirective(
  content: string,
): { workflowId?: number; stageId?: number } | null {
  const t = content.trim();
  if (!t.startsWith("open_create_task")) return null;
  // Se abriu `{` mas ainda não fechou (streaming), espera o JSON completar.
  if (t.includes("{") && !t.includes("}")) return null;
  const m = t.match(/\{[\s\S]*\}/);
  let workflowId: number | undefined;
  let stageId: number | undefined;
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { workflow_id?: unknown; stage_id?: unknown };
      if (o.workflow_id != null) workflowId = Number(o.workflow_id);
      if (o.stage_id != null) stageId = Number(o.stage_id);
    } catch {
      /* JSON inválido — usa o contexto do kanban */
    }
  }
  return { workflowId, stageId };
}

// Abre o modal de criação ao montar (dispara waves:create-task). Usa o workflow
// da diretiva OU, se ausente, o do kanban exibido por último (determinístico).
function CreateTaskTrigger({
  directive,
}: {
  directive: { workflowId?: number; stageId?: number };
}) {
  const wf = directive.workflowId ?? getKanbanCtx().workflowId;
  const st = directive.stageId ?? getKanbanCtx().stageId;
  useEffect(() => {
    // Abre sempre — sem workflow o modal mostra o seletor.
    window.dispatchEvent(
      new CustomEvent("waves:create-task", {
        detail: { workflowId: wf, stageId: st },
      }),
    );
    // só no mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="assistant-plain-text"
      style={{ padding: "0.75rem 1rem", opacity: 0.8 }}
    >
      Abrindo o formulário de nova tarefa…
    </div>
  );
}

function GenUIAssistantMessage({ message }: { message: { content?: string } }) {
  const content = typeof message.content === "string" ? message.content : "";
  const processMessage = useThread((s) => s.processMessage);
  const isStreaming = useThread((s) => s.isRunning);
  if (!content) return null;

  // Diretiva de criação de tarefa → abre o modal nativo automaticamente.
  const createDir = parseCreateTaskDirective(content);
  if (createDir) return <CreateTaskTrigger directive={createDir} />;

  // Job em background (Relatório MAP / Mídias Negativas): o agente emite um
  // `check_job: "<id>"`. Em vez de mostrar o texto cru, renderizamos um card
  // com progress bar ao vivo que vira o resultado quando o job conclui.
  const job = parseCheckJob(content);
  if (job) {
    return (
      <JobProgressCard
        jobId={job.jobId}
        etaSeconds={job.etaSeconds}
        onActionContent={(label, formState) => {
          const contentPart = label ? `<content>${label}</content>` : "";
          const ctx: unknown[] = [`User clicked: ${label ?? ""}`];
          if (formState) ctx.push(formState);
          processMessage({ role: "user", content: `${contentPart}<context>${JSON.stringify(ctx)}</context>` });
        }}
      />
    );
  }

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
        // edit_task: abre o modal NATIVO de edição (caminho B) — GET ao clicar,
        // sem passar pelo LLM. O card/botão emite {type:'edit_task', params:{task_id}}.
        if (event.type === "edit_task") {
          const raw = event.params?.task_id ?? event.params?.taskId;
          const taskId = raw != null ? Number(raw) : NaN;
          if (Number.isFinite(taskId)) {
            window.dispatchEvent(
              new CustomEvent("waves:edit-task", { detail: { taskId } }),
            );
          }
          return;
        }
        // create_task: abre o modal NATIVO de criação. params: {workflow_id, stage_id?}.
        if (event.type === "create_task") {
          const wf = Number(event.params?.workflow_id ?? event.params?.workflowId);
          const st = event.params?.stage_id ?? event.params?.funnel_stage_id;
          if (Number.isFinite(wf)) {
            window.dispatchEvent(
              new CustomEvent("waves:create-task", {
                detail: { workflowId: wf, stageId: st != null ? Number(st) : undefined },
              }),
            );
          }
          return;
        }
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

// NOTA: o polling de jobs em background agora é feito pelo <JobProgressCard>,
// que intercepta o `check_job` na própria mensagem do assistant e renderiza
// progress bar + resultado inline (vale pra ybrax E bioshield specialists).
// O antigo SpecialistJobPoller (hook use-pending-specialist-jobs) foi removido
// pra não duplicar polling/mensagens.

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

// Insere uma mensagem (assistant) no chat sem passar pelo LLM. Usado pra
// devolver no chat o feedback de ações nativas (ex.: "✅ Tarefa criada"),
// disparado via CustomEvent `waves:chat-append`. Precisa estar DENTRO do
// ChatProvider (os modais ficam fora e não acessam `appendMessages`).
function ChatAppendListener() {
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

// ─── Card de feedback (openui-lang) pra criar/editar tarefa ───────────────
// Escapa strings pro openui-lang (aspas quebram o parser) e limita tamanho.
function escOL(s: string): string {
  return String(s).replace(/[\r\n]+/g, " ").replace(/[\\"]/g, "'").slice(0, 120);
}
function fmtBR(d?: string): string | undefined {
  if (!d) return undefined;
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
}
interface TaskFeedback {
  id: number | null;
  title: string;
  stageName?: string;
  assigneeName?: string;
  dueDate?: string;
  checklistCount?: number;
}
function buildTaskCard(variant: "created" | "updated", r: TaskFeedback): string {
  const header = variant === "created" ? "✅ Tarefa criada" : "✏️ Tarefa atualizada";
  const sub = `${r.id != null ? `#${r.id} — ` : ""}${escOL(r.title)}`;
  const defs: string[] = [];
  const refs: string[] = [];
  const addTag = (label: string, v: string) => {
    const name = `tg${refs.length + 1}`;
    refs.push(name);
    defs.push(`${name} = Tag("${escOL(label)}", "${v}")`);
  };
  if (r.stageName) addTag(`Etapa: ${r.stageName}`, "secondary");
  if (r.assigneeName) addTag(`Resp.: ${r.assigneeName}`, "outline");
  const due = fmtBR(r.dueDate);
  if (due) addTag(`Prazo: ${due}`, "default");
  if (r.checklistCount && r.checklistCount > 0) {
    addTag(`Checklist: ${r.checklistCount} ${r.checklistCount === 1 ? "item" : "itens"}`, "outline");
  }
  const lines = [
    `root = Card([h${refs.length ? ", tags" : ""}])`,
    `h = CardHeader("${header}", "${sub}")`,
  ];
  if (refs.length) {
    lines.push(`tags = TagBlock([${refs.join(", ")}])`);
    lines.push(...defs);
  }
  return lines.join("\n");
}
function appendTaskCard(variant: "created" | "updated", r: TaskFeedback): void {
  window.dispatchEvent(
    new CustomEvent("waves:chat-append", { detail: { content: buildTaskCard(variant, r) } }),
  );
}

// Restaura o chat ao recarregar a página. O backend (state.db do Hermes) guarda
// as mensagens por sessão `waves-user-<id>::<thread>`; aqui buscamos as do thread
// ativo e semeamos o ChatProvider via `setMessages`. Independe da sidebar/lista
// de threads — só do threadId persistido (localStorage) + o user id da sessão.
function ThreadRestorer({
  profileId,
  fullThreadKey,
}: {
  profileId: string;
  fullThreadKey: string;
}) {
  const setMessages = useThread((s) => s.setMessages);
  const restoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fullThreadKey || restoredKeyRef.current === fullThreadKey) return;
    const isSwitch = restoredKeyRef.current !== null; // troca de conversa (não 1º load)
    restoredKeyRef.current = fullThreadKey;
    // Ao TROCAR de conversa, limpa imediatamente pra não mostrar as mensagens
    // do thread anterior enquanto o novo carrega.
    if (isSwitch) setMessages([]);
    let cancelled = false;
    (async () => {
      try {
        const msgs = await getThreadMessages(profileId, fullThreadKey);
        if (cancelled || msgs.length === 0) return;
        const restored = msgs
          .map(toOpenUIMessage)
          .filter((m): m is Message => m !== null);
        if (restored.length) setMessages(restored);
      } catch {
        /* sem histórico / rede — começa conversa vazia */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, fullThreadKey, setMessages]);

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

        // Guarda a requisição exata (follow-up, composer, etc.) para retomar após
        // queda de rede — ThreadErrorRecovery lê e chama processMessage de novo.
        const threadKey = `waves-user-${session.user.id}::${activeThreadId}`;
        const lastMsg = messages[messages.length - 1];
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
      session,
      userScope,
      defaultWorkflowId,
      persona,
    ],
  );

  // Drawer mobile da sidebar de conversas (#2). Fecha ao trocar de thread.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleSessionExpired = useCallback(() => {
    clearSession();
    onLogout();
  }, [onLogout]);

  const fullThreadKey = `waves-user-${session.user.id}::${activeThreadId}`;

  return (
    <div className="chat-shell">
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

      <div className={`chat-shell-body${mobileNavOpen ? " nav-open" : ""}`}>
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
            <ThreadRestorer profileId={activeProfile} fullThreadKey={fullThreadKey} />
            <ChatAppendListener />
            {mobileNavOpen && (
              <div
                className="chat-shell-nav-overlay"
                onClick={() => setMobileNavOpen(false)}
                aria-hidden="true"
              />
            )}
            <Shell.Container
              logoUrl={mode === "dark" ? "/waves_white.png" : "/waves_blue.png"}
              agentName="Agent"
            >
              <Shell.SidebarContainer>
                <Shell.SidebarHeader />
                <SidebarThreadHistory
                  profileId={activeProfile}
                  onNewChat={() => { handleNewChat(); setMobileNavOpen(false); }}
                  onSelectThread={(k) => { handleSelectThread(k); setMobileNavOpen(false); }}
                  activeThreadId={activeThreadId}
                  threadKeyPrefix={`waves-user-${session.user.id}::`}
                />
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
                  <ThreadErrorRecovery
                    session={session}
                    profileId={activeProfile}
                    fullThreadKey={fullThreadKey}
                    onSessionExpired={handleSessionExpired}
                    onScopeRefresh={setUserScope}
                  />
                </Shell.ScrollArea>
                <ChatComposer attachmentsRef={attachmentsRef} />
              </Shell.ThreadContainer>
            </Shell.Container>
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
