import { useEffect, useRef } from "react";
import type { Message } from "@ag-ui/core";

/**
 * Detecta automaticamente jobs de sub-agents pendentes nas mensagens do Steve
 * e injeta a resposta renderizada (openui-lang) quando o sub-agent termina.
 *
 * Como funciona:
 *
 * 1. Quando o Steve dispara `consult_*` (Vigia, Cronos, etc.), a resposta
 *    contém um FollowUp com `context={check_job: "<id>"}` — esse é o gancho.
 * 2. Este hook escaneia mensagens do assistente, extrai `check_job` por
 *    regex, e dispara polling no endpoint `/api/specialist-jobs/{id}/rendered`
 *    a cada `POLL_INTERVAL_MS`.
 * 3. Quando o endpoint retorna `status: "done"`, o `openui_lang` da resposta
 *    é injetado na conversa como uma nova mensagem do assistente — sem o
 *    user precisar clicar em "Ver resposta".
 *
 * Robusto a reload: ao montar, varre todo o histórico do thread e retoma
 * polling pra qualquer job ainda pendente. Idempotente: cada job_id é
 * polado UMA vez (Set em ref).
 *
 * Para parar todos os polls (ex: troca de thread), o cleanup do useEffect
 * limpa todos os intervals ativos.
 */

const POLL_INTERVAL_MS = 20_000;
const CHECK_JOB_RE = /check_job\s*[:=]\s*["']([a-zA-Z0-9]+)["']/g;
const MAX_POLLS_PER_JOB = 60; // ~20min de tentativas a 20s cada

interface UsePendingSpecialistJobsOptions {
  messages: Message[];
  appendMessages: (...messages: Message[]) => void;
}

export function usePendingSpecialistJobs({
  messages,
  appendMessages,
}: UsePendingSpecialistJobsOptions): void {
  // Set persistente de job_ids já polados/concluídos — evita re-poll quando
  // mensagens são re-renderizadas. Ref pra não causar re-render do hook.
  const polledRef = useRef<Set<string>>(new Set());
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );

  useEffect(() => {
    // Extrai todos os job_ids únicos referenciados em mensagens do assistant
    const pendingJobIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const content = extractContent(msg);
      if (!content) continue;
      const matches = content.matchAll(CHECK_JOB_RE);
      for (const m of matches) {
        pendingJobIds.add(m[1]);
      }
    }

    // Para cada job_id novo (não está polado nem foi polado antes), inicia
    // polling. Jobs já polados ignoram (mesmo que tenham terminado).
    for (const jobId of pendingJobIds) {
      if (polledRef.current.has(jobId)) continue;
      if (intervalsRef.current.has(jobId)) continue;
      startPolling(jobId, appendMessages, polledRef, intervalsRef);
    }

    // Cleanup: quando o hook desmonta, limpa todos os intervals.
    return () => {
      // NÃO limpar aqui em todo re-render do effect — isso pararia polls
      // ainda em andamento. Só limpamos no unmount real, que acontece
      // quando o thread troca ou o user sai do chat.
    };
  }, [messages, appendMessages]);

  // Cleanup definitivo no unmount
  useEffect(() => {
    return () => {
      for (const handle of intervalsRef.current.values()) {
        clearInterval(handle);
      }
      intervalsRef.current.clear();
    };
  }, []);
}

function extractContent(msg: Message): string {
  // AG-UI Message.content pode ser string ou array (multipart) — só
  // queremos texto puro.
  if (typeof (msg as { content?: unknown }).content === "string") {
    return (msg as { content: string }).content;
  }
  return "";
}

function startPolling(
  jobId: string,
  appendMessages: (...messages: Message[]) => void,
  polledRef: React.MutableRefObject<Set<string>>,
  intervalsRef: React.MutableRefObject<Map<string, ReturnType<typeof setInterval>>>,
): void {
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    if (attempts > MAX_POLLS_PER_JOB) {
      stopPolling(jobId, intervalsRef);
      polledRef.current.add(jobId);
      return;
    }
    try {
      const resp = await fetch(`/api/specialist-jobs/${encodeURIComponent(jobId)}/rendered`);
      if (!resp.ok && resp.status !== 200) {
        // 404 ou 5xx → para de tentar
        if (resp.status === 404 || resp.status >= 500) {
          stopPolling(jobId, intervalsRef);
          polledRef.current.add(jobId);
        }
        return;
      }
      const data = (await resp.json()) as {
        status: string;
        openui_lang?: string;
        error?: string;
      };

      if (data.status === "done" && data.openui_lang) {
        stopPolling(jobId, intervalsRef);
        polledRef.current.add(jobId);
        const newMessage = {
          id: `specialist-${jobId}-${Date.now()}`,
          role: "assistant",
          content: data.openui_lang,
        } as unknown as Message;
        appendMessages(newMessage);
        return;
      }

      if (data.status === "error" || data.status === "not_found") {
        stopPolling(jobId, intervalsRef);
        polledRef.current.add(jobId);
        // Injeta uma mensagem mínima informando o erro pro user
        const fallback = {
          id: `specialist-${jobId}-error-${Date.now()}`,
          role: "assistant",
          content: `root = Card([header, alert, followUps])
header = CardHeader("Especialista não respondeu")
alert = Alert(variant="warning", text="${(data.error ?? "Falha desconhecida").replace(/"/g, '\\"')}")
followUps = FollowUpBlock([
  FollowUpItem("Tentar de novo"),
  FollowUpItem("Ver status geral do projeto"),
  FollowUpItem("Continuar conversa")
])`,
        } as unknown as Message;
        appendMessages(fallback);
        return;
      }

      // queued/running → continua polando
    } catch (err) {
      // Erro de rede transiente — log no console e continua tentando
      console.warn(`[specialist-polling] ${jobId} attempt ${attempts}:`, err);
    }
  };

  // Dispara imediatamente uma vez (caso job já esteja done) e depois polla
  void tick();
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  intervalsRef.current.set(jobId, handle);
}

function stopPolling(
  jobId: string,
  intervalsRef: React.MutableRefObject<Map<string, ReturnType<typeof setInterval>>>,
): void {
  const handle = intervalsRef.current.get(jobId);
  if (handle) {
    clearInterval(handle);
    intervalsRef.current.delete(jobId);
  }
}
