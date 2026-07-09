import "dotenv/config";
import {
  buildWorkflowsListPath,
  buildWorkflowsListResult,
  extractWorkflowPagination,
} from "../shared/workflows-list.js";
import { getActiveTenant } from "./tenants.js";

export type WavesEnvironment = "dev" | "prod";

export interface WavesSession {
  environment: WavesEnvironment;
  accessToken: string;
}

interface EnvConfig {
  url: string;
  token: string;
}

function getEnvConfig(explicitTenant?: import("./tenants.js").Tenant): EnvConfig {
  const tenant = explicitTenant ?? getActiveTenant();
  return { url: tenant.url, token: tenant.key };
}

async function wavesFetch(
  session: WavesSession,
  path: string,
  init?: RequestInit,
  /** Tenant explícito — usa em vez do ALS (necessário quando multer quebra o contexto). */
  explicitTenant?: import("./tenants.js").Tenant,
): Promise<unknown> {
  const cfg = getEnvConfig(explicitTenant);

  if (!cfg.url || !cfg.token) {
    throw new Error("Credenciais Waves ausentes no servidor (.env).");
  }

  const response = await fetch(`${cfg.url}${path}`, {
    // Não pendura se a Waves travar (init.signal, se vier, tem precedência).
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-KEY": cfg.token,
      Authorization: `Bearer ${session.accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Erro ${response.status} na API Waves.`;
    throw new Error(message);
  }

  return body;
}

/**
 * Valida o token Sanctum do Babble e retorna o usuário autenticado (com `id`).
 * Usado pelo `/api/files` pra checar o DONO do arquivo no download (o token
 * vai no header do fetch autenticado do componente FileDownload). Lança se o
 * token for inválido/expirado (a Waves responde 401).
 */
export async function getWavesUser(
  session: WavesSession,
  /** Tenant explícito — usa em vez do ALS (necessário quando multer quebra o AsyncLocalStorage). */
  explicitTenant?: import("./tenants.js").Tenant,
): Promise<{ id: number } & Record<string, unknown>> {
  const body = (await wavesFetch(session, "/user", undefined, explicitTenant)) as Record<string, unknown>;
  // A Waves devolve {status, data: {user: {id, ...}}}; também aceitamos
  // {data: {id}} ou o objeto direto, por robustez a variações de shape.
  const data =
    body && typeof body === "object" && "data" in body && body.data
      ? (body.data as Record<string, unknown>)
      : body;
  const userObj =
    data && typeof data === "object" && "user" in data && data.user
      ? (data.user as Record<string, unknown>)
      : data;
  const id = Number(
    (userObj as { id?: unknown })?.id ?? (data as { id?: unknown })?.id,
  );
  if (!Number.isFinite(id)) {
    throw new Error("Resposta de /user sem id numérico.");
  }
  return { ...(userObj as Record<string, unknown>), id };
}

export async function listWorkflows(session: WavesSession) {
  const perPage = 100;
  const firstPage = await wavesFetch(session, buildWorkflowsListPath(1, perPage));
  const meta = extractWorkflowPagination(firstPage);
  const pages: unknown[] = [firstPage];

  if (meta && meta.lastPage > 1) {
    for (let page = 2; page <= meta.lastPage; page++) {
      pages.push(await wavesFetch(session, buildWorkflowsListPath(page, perPage)));
    }
  }

  return buildWorkflowsListResult(pages);
}

export async function getWorkflow(session: WavesSession, workflowId: number) {
  return wavesFetch(session, `/workflows/${workflowId}`);
}

export async function getWorkflowTasks(
  session: WavesSession,
  workflowId: number,
  query?: {
    funnel_stage_id?: number;
    status?: string;
    overdue?: boolean;
  },
) {
  const params = new URLSearchParams();
  if (query?.funnel_stage_id != null) {
    params.set("funnel_stage_id", String(query.funnel_stage_id));
  }
  if (query?.status) params.set("status", query.status);
  if (query?.overdue) params.set("overdue", "1");
  const qs = params.toString();
  return wavesFetch(
    session,
    `/workflows/${workflowId}/tasks${qs ? `?${qs}` : ""}`,
  );
}

export async function getWorkflowKanban(session: WavesSession, workflowId: number) {
  return wavesFetch(session, `/workflows/${workflowId}/kanban`);
}

export type WorkflowStatisticsMetric =
  | "overview"
  | "by-stage"
  | "by-user"
  | "by-task-type"
  | "timeline";

export async function getWorkflowStatistics(
  session: WavesSession,
  workflowId: number,
  metric: WorkflowStatisticsMetric,
  days = 30,
) {
  const path =
    metric === "timeline"
      ? `/workflows/${workflowId}/statistics/timeline?days=${days}`
      : `/workflows/${workflowId}/statistics/${metric}`;
  return wavesFetch(session, path);
}

export async function getTask(session: WavesSession, taskId: number) {
  return wavesFetch(session, `/tasks/${taskId}`);
}

// === Bookings / Appointments ================================================
// Endpoints da Babble pra agendas:
//   GET /appointments?booking_id=N&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
//   GET /bookings/:id/available-dates?start_date=...&end_date=...
//   GET /bookings/:id/available-slots/:date

export interface AppointmentFilter {
  start_date?: string; // ISO date (YYYY-MM-DD)
  end_date?: string;
  status?: string;
  page?: number;
  per_page?: number;
}

interface SlimAppointment {
  id: number;
  booking_id: number;
  date: string | null;          // YYYY-MM-DD (booking_slots_date)
  slot: string | null;          // "HH:MM-HH:MM" (booking_slots)
  status: string | null;        // pending | confirmed | cancelled
  patient_name: string | null;  // extraído do json (form field "nome") OU audience_member.name
  phone: string | null;         // audience_member.phone
  attendance_type: string | null; // "Convênio" | "Particular" (form field "atendimento")
  audience_member_id: number | null;
  no_show: boolean;
  created_at: string | null;
}

/**
 * Extrai os campos relevantes de um appointment cru da Babble.
 * A API retorna ~5KB por appointment (booking inteiro embedded com reminders,
 * prompts etc.). Pro contexto do LLM precisamos só de ~200 bytes por entry —
 * essa função reduz 25x sem perder info útil.
 *
 * Campos úteis:
 *  - patient_name: extrai do `json` field (form data preenchido) — field `nome.value`
 *  - phone: pega de `audience_member.phone` (mais confiável que form)
 *  - attendance_type: extrai do `json` field `atendimento` (radio selected)
 *  - date/slot: booking_slots_date + booking_slots (formato "HH:MM-HH:MM")
 */
function slimAppointment(raw: Record<string, unknown>): SlimAppointment {
  let patientName: string | null = null;
  let attendance: string | null = null;
  // O `json` field é uma string JSON com [[{type, name, label, value}, ...]]
  // representando o form preenchido. Extrai value de `nome` e selected de `atendimento`.
  const jsonStr = raw.json;
  if (typeof jsonStr === "string" && jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const fields: unknown[] = Array.isArray(parsed)
        ? Array.isArray(parsed[0])
          ? parsed[0]
          : parsed
        : [];
      for (const f of fields) {
        if (!f || typeof f !== "object") continue;
        const field = f as Record<string, unknown>;
        if (field.name === "nome" && typeof field.value === "string") {
          patientName = field.value;
        } else if (field.name === "atendimento" && Array.isArray(field.values)) {
          const selected = (field.values as Array<Record<string, unknown>>).find(
            (v) => v.selected,
          );
          if (selected && typeof selected.label === "string") {
            attendance = selected.label;
          }
        }
      }
    } catch {
      /* ignora json malformado */
    }
  }

  // Fallback: nome vem do audience_member se não veio do form
  const am = raw.audience_member as Record<string, unknown> | undefined;
  if (!patientName && am) {
    const amName = am.name;
    if (typeof amName === "string" && amName !== "Anônimo") patientName = amName;
  }
  const phone =
    am && typeof am.phone === "string"
      ? am.phone
      : null;

  return {
    id: Number(raw.id),
    booking_id: Number(raw.booking_id),
    date:
      typeof raw.booking_slots_date === "string"
        ? raw.booking_slots_date
        : null,
    slot: typeof raw.booking_slots === "string" ? raw.booking_slots : null,
    status: typeof raw.status === "string" ? raw.status : null,
    patient_name: patientName,
    phone,
    attendance_type: attendance,
    audience_member_id:
      typeof raw.audience_member_id === "number"
        ? raw.audience_member_id
        : null,
    no_show: raw.no_show === 1 || raw.no_show === true,
    created_at:
      typeof raw.created_at === "string" ? raw.created_at : null,
  };
}

/**
 * Lista appointments (compromissos marcados) de uma agenda em um período.
 * Retorna versão SLIM (só campos relevantes) pra não estourar tokens no LLM.
 *
 * Use `list_appointments_raw` (sem este wrapper) se precisar do payload bruto.
 */
export async function listAppointments(
  session: WavesSession,
  bookingId: number,
  filter: AppointmentFilter = {},
): Promise<{ booking_id: number; count: number; appointments: SlimAppointment[] }> {
  const q = new URLSearchParams();
  q.set("booking_id", String(bookingId));
  if (filter.start_date) q.set("start_date", filter.start_date);
  if (filter.end_date) q.set("end_date", filter.end_date);
  if (filter.status) q.set("status", filter.status);
  if (filter.page != null) q.set("page", String(filter.page));
  if (filter.per_page != null) q.set("per_page", String(filter.per_page));
  const resp = (await wavesFetch(
    session,
    `/appointments?${q.toString()}`,
  )) as { data?: { appointments?: unknown[] } } | undefined;
  const rawList = resp?.data?.appointments ?? [];
  const slim = rawList
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
    .map(slimAppointment);
  return {
    booking_id: bookingId,
    count: slim.length,
    appointments: slim,
  };
}

/**
 * Datas que ainda têm slots disponíveis numa agenda dentro de um período.
 * Útil pra mostrar "quando o paciente pode marcar".
 */
export async function getBookingAvailableDates(
  session: WavesSession,
  bookingId: number,
  startDate?: string,
  endDate?: string,
) {
  const q = new URLSearchParams();
  if (startDate) q.set("start_date", startDate);
  if (endDate) q.set("end_date", endDate);
  const qs = q.toString();
  const path = qs
    ? `/bookings/${bookingId}/available-dates?${qs}`
    : `/bookings/${bookingId}/available-dates`;
  return wavesFetch(session, path);
}

/**
 * Slots disponíveis em UM dia específico da agenda (granular: horários livres).
 */
export async function getBookingAvailableSlots(
  session: WavesSession,
  bookingId: number,
  date: string, // YYYY-MM-DD
) {
  return wavesFetch(session, `/bookings/${bookingId}/available-slots/${date}`);
}

// === Funnels ================================================================
// A Babble não expõe /funnels (404). O caminho é por assistant: cada assistant
// tem 0 ou 1 funnel acessível via GET /assistants/{id}/funnel.
// Stages são embedded no payload do funnel.

export interface SlimFunnelStage {
  id: number;
  name: string | null;
  color: string | null;
  order: number | null;
  parent_id: number | null;
  hidden: boolean;
  has_behaviour: boolean;       // true se stage tem regra/behaviour (não expõe o prompt)
  has_form: boolean;            // true se há lead_capture_form_id nesta stage
}

export interface SlimFunnel {
  id: number;
  name: string | null;
  description: string | null;
  assistant_id: number;
  workflow_id: number | null;
  audience_id: number | null;
  lead_capture_form_id: number | null;
  assign_type: string | null;
  cadence_cron_expression: string | null;
  stages_count: number;
  stages: SlimFunnelStage[];
}

function slimFunnelStage(raw: Record<string, unknown>): SlimFunnelStage {
  return {
    id: Number(raw.id),
    name: typeof raw.name === "string" ? raw.name : null,
    color: typeof raw.color === "string" ? raw.color : null,
    order: typeof raw.order === "number" ? raw.order : null,
    parent_id:
      typeof raw.parent_id === "number" ? raw.parent_id : null,
    hidden: raw.hidden === true || raw.hidden === 1,
    has_behaviour:
      raw.behaviour != null && raw.behaviour !== "" && raw.behaviour !== false,
    has_form: raw.lead_capture_form_id != null,
  };
}

function slimFunnel(raw: Record<string, unknown>, assistantId: number): SlimFunnel {
  const stagesRaw = Array.isArray(raw.stages) ? (raw.stages as unknown[]) : [];
  const stages = stagesRaw
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
    .map(slimFunnelStage);
  return {
    id: Number(raw.id),
    name: typeof raw.name === "string" ? raw.name : null,
    description:
      typeof raw.description === "string" ? raw.description : null,
    assistant_id: assistantId,
    workflow_id:
      typeof raw.workflow_id === "number" ? raw.workflow_id : null,
    audience_id:
      typeof raw.audience_id === "number" ? raw.audience_id : null,
    lead_capture_form_id:
      typeof raw.lead_capture_form_id === "number"
        ? raw.lead_capture_form_id
        : null,
    assign_type: typeof raw.assign_type === "string" ? raw.assign_type : null,
    cadence_cron_expression:
      typeof raw.cadence_cron_expression === "string"
        ? raw.cadence_cron_expression
        : null,
    stages_count: stages.length,
    stages,
  };
}

/**
 * Funnel (funil de captação) associado a um assistant. Retorna versão slim:
 * descarta campos longos do stage (prompt, behaviour text, context_message,
 * help_text) — payload reduz de ~20KB pra ~1KB por funnel sem perder o que
 * o agente precisa pra renderizar (nome, cor, ordem, parent, has_form).
 *
 * Retorna `null` se o assistant não tem funnel (HTTP 404).
 */
export async function getAssistantFunnel(
  session: WavesSession,
  assistantId: number,
): Promise<SlimFunnel | null> {
  let resp: { data?: { funnel?: Record<string, unknown> } } | undefined;
  try {
    resp = (await wavesFetch(
      session,
      `/assistants/${assistantId}/funnel`,
    )) as { data?: { funnel?: Record<string, unknown> } } | undefined;
  } catch (err) {
    // 404 = sem funnel; outras propagam
    if (err instanceof Error && /\b404\b/.test(err.message)) return null;
    throw err;
  }
  const funnel = resp?.data?.funnel;
  if (!funnel) return null;
  return slimFunnel(funnel, assistantId);
}

/**
 * Lista funis de uma coleção de assistants em paralelo (1 request por assistant).
 * Filtra os que não têm funnel. Usado no fetchUserScope para popular contexto
 * de funis logo no login.
 */
export async function listFunnelsForAssistants(
  session: WavesSession,
  assistantIds: number[],
): Promise<SlimFunnel[]> {
  const results = await Promise.allSettled(
    assistantIds.map((id) => getAssistantFunnel(session, id)),
  );
  const out: SlimFunnel[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}
