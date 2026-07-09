/**
 * Limpeza dos caches ESCOPADOS POR USUÁRIO/TENANT do front.
 *
 * Vários caches do cliente (relatórios genui, resultados de job, workflows,
 * threads ativas, histórico de atalhos, pending chat) vivem em localStorage/
 * sessionStorage + memória e NÃO eram limpos ao trocar de usuário. Num navegador
 * compartilhado, o usuário B via resquícios do usuário A (dados, ids de thread,
 * relatórios). Aqui centralizamos a purga — chamada no LOGIN (autenticação nova)
 * e no LOGOUT.
 *
 * Preservados de propósito: preferências de tema (`waves-theme-*`, UX não
 * sensível) e o motivo de expiração (`waves_session_expired_reason`, consumido
 * pela tela de login logo após sair). A própria sessão sai via `clearSession()`.
 */
import { resetWorkflowCaches } from "./openui-tools";
import { resetKanbanCtx } from "./kanban-context";

// Chaves (prefixo) a purgar — cobrem localStorage E sessionStorage.
const PURGE_PREFIXES = [
  "waves:report-cache",
  "waves:createtask-consumed",
  "waves-thread-", // active thread por profile/tenant (localStorage)
  "waves-tab-thread-", // active thread por aba (sessionStorage)
  "waves-reasoning-", // esforço de reasoning por thread
  "waves_job_result_v1:", // resultados de job (dados do usuário)
  "waves-shortcut::", // histórico de mensagens de atalho (conteúdo do chat)
  "waves-active-profile", // profile/aba selecionada
  "wfTasks:", // tarefas de workflow (sessionStorage)
  "wfList:", // lista de workflows (sessionStorage)
  "waves_pending_chat_v1:", // requisição de chat pendente (conteúdo)
];

function sweep(store: Storage): void {
  const toRemove: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && PURGE_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
  }
  for (const k of toRemove) store.removeItem(k);
}

/** Purga todo cache escopado por usuário/tenant. Idempotente. */
export function purgeUserScopedCaches(): void {
  try {
    resetWorkflowCaches();
    resetKanbanCtx();
  } catch {
    /* módulos de cache indisponíveis — segue pra purga do storage */
  }
  try {
    if (typeof window !== "undefined") {
      sweep(window.localStorage);
      sweep(window.sessionStorage);
    }
  } catch {
    /* storage indisponível — nada a fazer */
  }
}
