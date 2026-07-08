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
import { AnalysisReport } from "../lib/shadcn-genui/components/analysis-report";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatComposer } from "./ChatComposer";
import { UserMessageView } from "./UserMessageView";
import { MessageExport } from "./MessageExport";
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
  getThreadMessages,
  toOpenUIMessage,
  setThreadGateway,
} from "../api/threads";
import { JobProgressCard, parseCheckJob, stripJobMarker } from "./JobProgressCard";
import { ActiveThreadContext } from "../lib/active-thread-context";
import {
  setRunningThread,
  clearRunningThread,
  markBackgroundRun,
  clearBackgroundRun,
  useBackgroundJobWatcher,
  useBackgroundRunWatcher,
} from "../lib/active-runs";
import type { ThreadMessage } from "../api/threads";
import { ThreadErrorRecovery } from "./ThreadErrorRecovery";
import { clearSession } from "../lib/session";
import {
  useSessionGuard,
  setExpiredReason,
  type ExpireReason,
} from "../lib/session-guard";
import { installAuthInterceptor } from "../lib/fetch-interceptor";
import { fetchTenantBranding, type TenantBranding } from "../lib/tenant";
import { getKanbanCtx } from "../lib/kanban-context";
import {
  consumeCreateTask,
  wasCreateTaskConsumed,
  setCreateTaskThreadKey,
} from "../lib/createtask-consumed";
import { setReportThreadKey } from "../lib/report-cache";
import { loadShortcuts, saveShortcutExchange } from "../lib/shortcut-history";
import {
  ensureToolProvider,
  getToolProvider,
  resolveWorkflowIdByLabel,
  setActiveAgentId,
} from "../lib/openui-tools";
import {
  setAdminFlag,
  isAdmin,
  messageTime,
  primeMessageTime,
  fmtTime,
  extractUsage,
} from "../lib/message-meta";
import { isAdminUser } from "../lib/permissions";
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

/** Mapeia um starter da PLATAFORMA (shape variável) pro ProfileStarter local. */
function mapPlatformStarter(s: unknown): ProfileStarter | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const display = o.displayText ?? o.title ?? o.label ?? o.text ?? o.name;
  // Starter sem rótulo (placeholder da plataforma, ex.: Steve hoje) → ignora.
  if (display == null || String(display).trim() === "") return null;
  const prompt = o.prompt ?? o.message ?? o.content ?? display;
  const icon = typeof o.icon === "string" ? o.icon : undefined;
  return { displayText: String(display), prompt: String(prompt), icon };
}

/** Starters da plataforma pro profile ativo (login agent.starters, por porta). */
function platformStartersFor(
  activeProfile: string,
  available: ProfileOption[],
  agents: AgentItem[] | undefined,
): ProfileStarter[] {
  const port = available.find((p) => p.id === activeProfile)?.port;
  if (port == null) return [];
  const agent = (agents ?? []).find((a) => a.port === port);
  const raw = agent?.starters;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map(mapPlatformStarter)
    .filter((x): x is ProfileStarter => x != null);
}
import { getEnvironmentLabel } from "../config/env";
import { personaLabel } from "../lib/permissions";
import { useTheme } from "../hooks/use-system-theme";
import type { AgentItem, AuthSession } from "../types/auth";

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

/**
 * openui-lang NÃO aceita o literal `null` — alguns agentes o usam como
 * placeholder posicional (ex.: `GenerateExecutiveUpdate(106, "6.4", null,
 * "analitico")`), o que QUEBRA a renderização (vira texto cru). Removemos `null`
 * como ARGUMENTO (fora de aspas) só nas chamadas dos nossos componentes de
 * relatório — strings com a palavra "null" não são afetadas. Com a ordem atual
 * dos props, remover o null já alinha os args (mode passa a ser o 3º).
 */
function stripNullArgs(s: string): string {
  return s.replace(
    /(GenerateExecutiveUpdate|GenerateReportPdf)\s*\(([^()]*)\)/g,
    (_full, name: string, args: string) => {
      const kept = args
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((a) => a.trim())
        .filter((a) => a !== "null" && a !== "");
      return `${name}(${kept.join(", ")})`;
    },
  );
}

/**
 * Marcador `exec_report:{...}` — emitido pela TOOL `generate_executive_report`
 * (via skill no SOUL). É o gatilho ROBUSTO do relatório executivo: o agente não
 * monta openui-lang (sem fragilidade de args/null). Aqui o client lê o marcador
 * e CONSTRÓI a chamada openui-lang correta — a string é nossa, não do LLM.
 */
/**
 * Marcador `analysis_report:{...}` — tool `generate_analysis_report`. Relatório
 * ANALÍTICO/custom escrito pela IA, focado na instrução do usuário. Renderizado
 * direto em React (a instrução é texto livre — não passa por openui-lang).
 */
const ANALYSIS_REPORT_RE = /analysis_report\s*:\s*(\{[\s\S]*\})/;
function parseAnalysisReport(
  content: string,
): { workflow_id: number; instruction: string; ap_number?: string; scope?: string } | null {
  const m = content.match(ANALYSIS_REPORT_RE);
  if (!m) return null;
  try {
    // Handle double-escaped quotes from gateway JSON serialization
    type AnalysisPayload = { workflow_id?: unknown; instruction?: unknown; ap_number?: unknown; scope?: unknown };
    let jsonStr = m[1];
    let o: AnalysisPayload | null = null;
    for (let attempt = 0; attempt < 3 && !o; attempt++) {
      try {
        o = JSON.parse(jsonStr) as AnalysisPayload;
      } catch {
        jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    if (!o) return null;
    const wf = Number(o.workflow_id);
    const scope = typeof o.scope === "string" ? o.scope : undefined;
    const isProject = scope === "project" || (!Number.isFinite(wf) && !o.ap_number);
    if (!Number.isFinite(wf) && !isProject) return null;
    return {
      workflow_id: Number.isFinite(wf) ? wf : 0,
      instruction: typeof o.instruction === "string" ? o.instruction : "Análise executiva.",
      ap_number: o.ap_number != null ? String(o.ap_number) : undefined,
      scope: isProject ? "project" : scope,
    };
  } catch {
    return null;
  }
}

const EXEC_REPORT_RE = /exec_report\s*:\s*(\{[\s\S]*?\})/;
const EXEC_MODES = ["completo", "resumido", "analitico"];
function execReportToOpenui(content: string): string | null {
  const m = content.match(EXEC_REPORT_RE);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as { workflow_id?: unknown; ap_number?: unknown; mode?: unknown };
    const wf = Number(o.workflow_id);
    if (!Number.isFinite(wf)) return null;
    const ap = o.ap_number != null ? String(o.ap_number).replace(/"/g, "") : "";
    const mode = EXEC_MODES.includes(String(o.mode)) ? String(o.mode) : "completo";
    return `root = GenerateExecutiveUpdate(${wf}, "${ap}", "${mode}")`;
  } catch {
    return null;
  }
}

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
//
// A diretiva é uma MENSAGEM persistida no histórico — então este componente
// re-monta a cada reload/troca de chat. Sem guarda, o modal reabriria sozinho
// (zumbi). `consumeCreateTask` marca cada diretiva (thread+conteúdo) → auto-abre
// SÓ na 1ª vez (mensagem ao vivo); depois vira um link de reabrir manual.
function CreateTaskTrigger({
  directive,
  content,
}: {
  directive: { workflowId?: number; stageId?: number };
  content: string;
}) {
  const wf = directive.workflowId ?? getKanbanCtx().workflowId;
  const st = directive.stageId ?? getKanbanCtx().stageId;
  // Leitura pura no render (sem efeito colateral): a diretiva já foi consumida?
  const fresh = !wasCreateTaskConsumed(content);
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("waves:create-task", {
        detail: { workflowId: wf, stageId: st },
      }),
    );
  useEffect(() => {
    // Re-checa dentro do efeito: cobre o double-invoke do StrictMode e garante
    // exatamente UM auto-open por diretiva. Sem workflow o modal mostra o seletor.
    if (wasCreateTaskConsumed(content)) return;
    consumeCreateTask(content);
    open();
    // só no mount; a decisão de abrir mora na guarda acima
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="assistant-plain-text"
      style={{ padding: "0.75rem 1rem", opacity: 0.8 }}
    >
      {fresh ? (
        "Abrindo o formulário de nova tarefa…"
      ) : (
        <button
          type="button"
          onClick={open}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            font: "inherit",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Abrir formulário de nova tarefa
        </button>
      )}
    </div>
  );
}

// Container único por mensagem assistant (alinha ao shell padrão). Sem isto,
// Renderer + MessageMeta viram dois filhos diretos da lista — o rodapé vira o
// :last-child e herda min-height ~100dvh do scroll-anchor da lib OpenUI.
function AssistantMessageShell({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="openui-shell-thread-message-assistant openui-shell-thread-message-assistant--without-logo waves-assistant-message">
      <div className="openui-shell-thread-message-assistant__content">
        <div className="msg-actions-top">
          <MessageExport />
        </div>
        {children}
        {meta}
      </div>
    </div>
  );
}

// Rodapé de cada mensagem: horário + (admin) tokens da geração. Mensagem
// nativa (sem chamada LLM) não tem usage → mostra "0 tok".
function MessageMeta({
  id,
  timestamp,
  usage,
}: {
  id?: string;
  timestamp?: number;
  usage: ReturnType<typeof extractUsage>["usage"];
}) {
  const threadId = useContext(ActiveThreadContext);
  return (
    <div className="waves-assistant-message__meta">
      <span>{fmtTime(messageTime(id, timestamp))}</span>
      {isAdmin() && (
        <span title="Tokens da geração (P=prompt, C=completion)">
          🪙 {usage ? `${usage.t} tok · P:${usage.p}/C:${usage.c}` : "0 tok"}
        </span>
      )}
      {isAdmin() && (
        <span className="waves-meta-debug" title={`Thread: ${threadId}\nMsg: ${id || "—"}`}>
          🧵 {threadId?.slice(0, 8)} · #{id?.slice(0, 8) || "—"}
        </span>
      )}
    </div>
  );
}

function GenUIAssistantMessage({
  message,
}: {
  message: { id?: string; content?: string; timestamp?: number };
}) {
  const rawContent = typeof message.content === "string" ? message.content : "";
  const processMessage = useThread((s) => s.processMessage);
  const isStreaming = useThread((s) => s.isRunning);
  if (!rawContent) return null;

  // Separa o marcador de usage do conteúdo renderável.
  const { clean: rawClean, usage } = extractUsage(rawContent);
  const meta0 = <MessageMeta id={message.id} timestamp={message.timestamp} usage={usage} />;
  // Marcador analysis_report (tool) → relatório analítico/custom escrito pela IA.
  const analysisReq = parseAnalysisReport(rawClean);
  if (analysisReq) {
    return (
      <AssistantMessageShell meta={meta0}>
        <AnalysisReport
          workflow_id={analysisReq.workflow_id}
          instruction={analysisReq.instruction}
          ap_number={analysisReq.ap_number}
          scope={analysisReq.scope}
        />
      </AssistantMessageShell>
    );
  }
  // Marcador exec_report (tool) → vira a chamada openui-lang correta (string
  // nossa, à prova de null/posição). O relatório é auto-contido, então o resto
  // do texto é descartado.
  const execOpenui = execReportToOpenui(rawClean);
  const content = execOpenui ?? rawClean;
  const meta = <MessageMeta id={message.id} timestamp={message.timestamp} usage={usage} />;

  // Diretiva de criação de tarefa → abre o modal nativo automaticamente.
  const createDir = parseCreateTaskDirective(content);
  if (createDir) {
    return (
      <AssistantMessageShell meta={meta}>
        <CreateTaskTrigger directive={createDir} content={content} />
      </AssistantMessageShell>
    );
  }

  // Job em background (specialist Vigia/Cronos/… ou Relatório MAP/Mídias): o
  // agente dispara o sub-agent e referencia o job (marcador `check_job: "<id>"`
  // ou, na prática, `Job: <id>` em prosa). Mostramos a PRELIMINAR do agente E,
  // logo abaixo, o card vivo "Vigia analisando…" que polla e vira o resultado
  // quando o job conclui. `bodyContent` tira só um marcador solto (não o de
  // dentro do openui) pra não exibir o id cru.
  const job = parseCheckJob(content);
  const bodyContent = job ? stripJobMarker(content) : content;
  const hasBody = bodyContent.trim().length > 0;
  const jobCard = job ? (
    <JobProgressCard
      jobId={job.jobId}
      etaSeconds={job.etaSeconds}
      specialist={job.specialist}
      onActionContent={(label, formState) => {
        const contentPart = label ? `<content>${label}</content>` : "";
        const ctx: unknown[] = [`User clicked: ${label ?? ""}`];
        if (formState) ctx.push(formState);
        processMessage({ role: "user", content: `${contentPart}<context>${JSON.stringify(ctx)}</context>` });
      }}
    />
  ) : null;

  // Só o marcador (sem preliminar) → renderiza apenas o card vivo.
  if (job && !hasBody) {
    return <AssistantMessageShell meta={meta}>{jobCard}</AssistantMessageShell>;
  }

  // Texto puro (sem construções openui-lang) → bolha de chat simples (+ card).
  if (!OPENUI_PATTERN.test(bodyContent)) {
    return (
      <AssistantMessageShell meta={meta}>
        <div className="assistant-plain-text" style={{
          padding: "0.75rem 1rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {bodyContent}
        </div>
        {jobCard}
      </AssistantMessageShell>
    );
  }

  return (
    <AssistantMessageShell meta={meta}>
    <Renderer
      response={stripNullArgs(bodyContent)}
      library={shadcnChatLibrary}
      isStreaming={isStreaming}
      toolProvider={getToolProvider() ?? undefined}
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
            /^https:\/\/([a-z0-9-]+\.)*devell\.com\.br(\/|$)/i.test(url) ||
            /^https:\/\/secure\.d4sign\.com\.br(\/|$)/i.test(url) ||
            /^https:\/\/teams\.microsoft\.com(\/|$)/i.test(url);
          if (safe) {
            window.open(url, "_blank", "noopener,noreferrer");
          } else if (url) {
            console.warn("[openui] open_url bloqueado (fora da allowlist):", url);
          }
        }
      }}
    />
    {jobCard}
    </AssistantMessageShell>
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
function WelcomeArea({
  starters,
  title,
  subtitle,
}: {
  starters: ProfileStarter[];
  title?: string;
  subtitle?: string;
}) {
  const messages = useThread((s) => s.messages);
  const isLoadingMessages = useThread((s) => s.isLoadingMessages);
  const processMessage = useThread((s) => s.processMessage);
  const isRunning = useThread((s) => s.isRunning);
  if (!isChatEmpty({ isLoadingMessages, messages })) return null;

  return (
    <Shell.WelcomeScreen>
      <div className="waves-welcome">
        {/* Título/subtítulo vêm da PLATAFORMA (page_title/page_subtitle).
            Se vier null/vazio → fica em branco (sem texto de fallback). */}
        {title?.trim() && (
          <h2 className="waves-welcome__title">{title.trim()}</h2>
        )}
        {subtitle?.trim() && (
          <p className="waves-welcome__desc">{subtitle.trim()}</p>
        )}
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

// Bridge: vive DENTRO do ChatProvider, conecta o evento waves:file-upload-complete
// ao processMessage do useThread. Renderiza nada.
function FileUploadBridge({ bridgeRef }: { bridgeRef: React.MutableRefObject<((files: any[]) => void) | null> }) {
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
// Espelha o `isRunning` (global da lib) no active-runs, capturando a thread
// ORIGINADORA na borda de subida do run — base pra escopar o "pensando" e o
// badge por thread (#828). Limpa quando o run termina (inclui o cancel ao
// trocar/abrir chat).
function RunTracker({ activeThreadId }: { activeThreadId: string }) {
  const isRunning = useThread((s) => s.isRunning);
  const wasRunning = useRef(false);
  const runOriginRef = useRef<string>("");
  useEffect(() => {
    if (isRunning && !wasRunning.current) {
      setRunningThread(activeThreadId);
      // #829 — o gateway persiste a resposta mesmo se você navegar; registra o
      // run em background pra manter o badge na thread e detectar a conclusão.
      markBackgroundRun(activeThreadId);
      runOriginRef.current = activeThreadId;
    } else if (!isRunning && wasRunning.current) {
      clearRunningThread();
      // #829 — se terminou e você AINDA está na thread de origem = conclusão em
      // FOREGROUND (resposta já visível) → limpa o badge na hora. Se você NAVEGOU
      // (origem ≠ ativa), deixa o bg-run pro watcher detectar a conclusão real.
      if (runOriginRef.current && runOriginRef.current === activeThreadId) {
        clearBackgroundRun(runOriginRef.current);
      }
      runOriginRef.current = "";
    }
    wasRunning.current = isRunning;
  }, [isRunning, activeThreadId]);
  return null;
}

// Vigia em background os check_jobs pendentes e limpa o badge ao terminar (#828).
function BackgroundJobWatcher() {
  useBackgroundJobWatcher();
  return null;
}

// #804 — ancora o scroll no FIM (última mensagem visível, estilo WhatsApp) ao
// ABRIR/HIDRATAR uma thread. O scrollVariant="always" da lib dispara o scroll de
// carga cedo demais (antes do setMessages assíncrono do ThreadRestorer popular o
// DOM) e trava; aqui ancoramos INSTANTANEAMENTE quando as mensagens chegam, uma
// vez por abertura de thread. Durante streaming/nova msg quem cuida é o "always".
function ScrollAnchorOnOpen({ threadKey }: { threadKey: string }) {
  const messages = useThread((s) => s.messages);
  const isRunning = useThread((s) => s.isRunning);
  const anchoredFor = useRef<string>("");
  useEffect(() => {
    if (!threadKey || isRunning) return;
    // Troca de thread limpa as mensagens (setMessages([])) antes de hidratar:
    // reseta o latch pra re-ancorar quando as novas mensagens chegarem.
    if (messages.length === 0) {
      anchoredFor.current = "";
      return;
    }
    if (anchoredFor.current === threadKey) return; // já ancorou esta abertura
    const el = document.querySelector<HTMLElement>(".openui-shell-thread-scroll-area");
    if (!el) return;
    anchoredFor.current = threadKey;
    // rAF: garante que o layout das mensagens já foi aplicado. Instantâneo (sem animação).
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, threadKey, isRunning]);
  return null;
}

// #829 — vigia runs em background (thread deixada rodando ao navegar): quando o
// gateway termina e persiste a resposta, limpa o badge e, se a thread é a ativa,
// recarrega as mensagens pra mostrar o resultado sem o usuário ter de recarregar.
function BackgroundRunWatcher({
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

// ─── Atalho determinístico: "abrir kanban do AP X" → SEM LLM ──────────────
// O esqueleto do board é fixo (`Query(get_workflow_kanban) + WorkflowKanban`),
// então não há por que gastar um turno LLM (~38k tok input) pra re-emitir algo
// constante. Detectamos o intent no transport (cobre composer E followUp),
// resolvemos o workflow_id client-side (1 GET cacheado) e devolvemos o
// openui-lang num SSE sintético — o runtime renderiza e busca os dados sozinho.
// Mesma filosofia do CREATE_TASK_INTENT (modal direto) e do form-cache.
const OPEN_KANBAN_INTENT =
  /^\s*(abrir?|abra|mostr(?:ar|e|a)|ver|exib(?:ir|a|e)|carreg(?:ar|a|ue)|ir\s+(?:pra|para|ao|à))\b[^.?!]{0,30}\bkanban\b/i;
// "Gantt do AP 1", "mostrar o cronograma do 6.4", "ver linha do tempo do AP 2".
// Verbo opcional (a frase pode começar direto em "Gantt"). NÃO casa "o que é um
// gantt?" (a palavra não está no início).
const OPEN_GANTT_INTENT =
  /^\s*(?:(?:abrir?|abra|mostr(?:ar|e|a)|ver|exib(?:ir|a|e)|gerar?|gere|criar?|crie|montar?|monte|quero|preciso)\b[^.?!]{0,24}\s+)?(gantt|cronograma|linha\s+do\s+tempo|timeline)\b/i;
// Qualificador de Gantt do PROJETO inteiro (vários APs, sem um AP específico):
// "gantt geral", "cronograma do projeto", "gantt de todos os APs", "portfólio".
const PROJECT_GANTT_QUALIFIER =
  /\b(geral|do\s+projeto|projeto\s+inteiro|de\s+todos|todos\s+os\s+ap|portf[óo]lio|portfolio)\b/i;
// Extrai o rótulo do AP ("AP 6.4", "kanban/gantt/cronograma do 1", "workflow 90").
const AP_LABEL =
  /\b(?:ap|action\s*plan|workflow|wf)\s*#?\s*(\d+(?:\.\d+)?)|(?:kanban|gantt|cronograma|timeline)\s+(?:do|da|de|no|pra|para|pro)?\s*#?\s*(\d+(?:\.\d+)?)/i;

function buildKanbanOpenui(workflowId: number, label: string, name?: string): string {
  const sub = name ? escOL(name) : "Quadro ao vivo · arraste cards, clique pra editar";
  return [
    `root = Card([header, board])`,
    `header = CardHeader("Kanban — AP ${escOL(label)}", "${sub}")`,
    `kb = Query("get_workflow_kanban", {id: ${workflowId}}, {stages: []})`,
    `board = WorkflowKanban(kb)`,
  ].join("\n");
}

function buildGanttOpenui(workflowId: number, label: string, name?: string): string {
  const sub = name ? escOL(name) : "Cronograma ao vivo · barras por prazo, clique pra editar";
  return [
    `root = Card([header, gantt])`,
    `header = CardHeader("Cronograma — AP ${escOL(label)}", "${sub}")`,
    `g = Query("get_workflow_gantt", {workflow_id: ${workflowId}}, {rows: []})`,
    `gantt = WorkflowGantt(g)`,
  ].join("\n");
}

function buildProjectGanttOpenui(): string {
  return [
    `root = Card([header, gantt])`,
    `header = CardHeader("Cronograma do projeto", "Todos os workflows · expanda pra ver tarefas e subtarefas")`,
    `pg = Query("get_project_gantt", {}, {workflows: []})`,
    `gantt = ProjectGantt(pg)`,
  ].join("\n");
}

// Monta um Response SSE idêntico ao do /api/chat (1 chunk de content + DONE),
// pro runtime consumir como se viesse do servidor — porém sem rede/LLM.
function syntheticSse(content: string): Response {
  const enc = new TextEncoder();
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id: `chatcmpl-local-${crypto.randomUUID()}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk({ content }, null));
      controller.enqueue(chunk({}, "stop"));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

// Tenta resolver o atalho de visão de workflow (kanban OU gantt). Retorna um
// Response SSE (renderiza sem LLM) ou null (cai no fluxo normal /api/chat).
// Determinístico: o openui-lang é fixo, então não gastamos turno de LLM (que
// ainda por cima é inconsistente — às vezes nem re-renderiza). Nunca lança.
async function tryWorkflowViewShortcut(text: string): Promise<string | null> {
  if (!text) return null;
  const isGantt = OPEN_GANTT_INTENT.test(text);
  const isKanban = !isGantt && OPEN_KANBAN_INTENT.test(text);
  if (!isGantt && !isKanban) return null;
  // Gantt do PROJETO inteiro (vários APs) → ProjectGantt hierárquico, sem AP.
  if (isGantt && PROJECT_GANTT_QUALIFIER.test(text)) return buildProjectGanttOpenui();
  const m = text.match(AP_LABEL);
  const label = m?.[1] ?? m?.[2];
  let workflowId: number | undefined;
  let resolvedName: string | undefined;
  let shownLabel = label;
  try {
    if (label) {
      const res = await resolveWorkflowIdByLabel(label);
      if (res) {
        workflowId = res.id;
        resolvedName = res.name;
      }
    } else {
      // Sem AP no texto ("abra o kanban") → usa o workflow já em contexto.
      const ctx = getKanbanCtx().workflowId;
      if (ctx != null) {
        workflowId = ctx;
        shownLabel = String(ctx);
      }
    }
  } catch {
    return null;
  }
  if (workflowId == null) return null; // não deu pra resolver → deixa o agente
  const lbl = shownLabel ?? String(workflowId);
  return isGantt
    ? buildGanttOpenui(workflowId, lbl, resolvedName)
    : buildKanbanOpenui(workflowId, lbl, resolvedName);
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
      let msgs: Awaited<ReturnType<typeof getThreadMessages>> = [];
      try {
        msgs = await getThreadMessages(profileId, fullThreadKey);
      } catch {
        /* sem histórico / rede — segue só com os atalhos locais (se houver) */
      }
      if (cancelled) return;
      // Mescla o histórico do gateway com as mensagens de ATALHO (Gantt/kanban)
      // guardadas em localStorage — elas não passam pelo gateway, então não
      // estão no state.db. Ordena por timestamp; dedup por conteúdo (caso um
      // turno real tenha persistido a mesma UI depois).
      const norm = (t: number) => (t && t < 1e12 ? t * 1000 : t || 0);
      const gwContents = new Set(msgs.map((m) => m.content));
      const items: Array<{ ts: number; msg: Message }> = [];
      msgs.forEach((m) => {
        const om = toOpenUIMessage(m);
        if (om) items.push({ ts: norm(m.timestamp), msg: om });
      });
      for (const s of loadShortcuts(fullThreadKey)) {
        if (gwContents.has(s.content)) continue;
        const scId = `sc-${s.ts}-${s.role}`;
        // #830 — atalhos não passam por toOpenUIMessage; semeia o horário real
        // pra não cair em Date.now() no reload.
        primeMessageTime(scId, s.ts);
        items.push({
          ts: s.ts,
          msg: { id: scId, role: s.role, content: s.content } as Message,
        });
      }
      if (cancelled || items.length === 0) return;
      items.sort((a, b) => a.ts - b.ts);
      setMessages(items.map((i) => i.msg));
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, fullThreadKey, setMessages]);

  return null;
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

  // #790 — 401/403 em qualquer chamada /api/* → sessão expirou → logout + login.
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
                />
                <Shell.ScrollArea scrollVariant="always">
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
                <ChatComposer
                  attachmentsRef={attachmentsRef}
                  reasoningMode={reasoningMode}
                  onToggleReasoning={
                    reasoningPolicy === "Selectable" ? toggleReasoning : undefined
                  }
                />
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
