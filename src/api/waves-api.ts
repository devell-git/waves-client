import { getEnvConfig } from "../config/env";
import {
  buildWorkflowsListPath,
  buildWorkflowsListResult,
  extractWorkflowPagination,
} from "../../shared/workflows-list";
import type {
  AssistantItem,
  AuthSession,
  BookingItem,
  FunnelItem,
  FunnelStageItem,
  LoginResult,
  WavesUser,
  WorkflowsResponse,
} from "../types/auth";

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Resposta inválida do servidor.");
  }
}

function authHeaders(apiKey: string, accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-API-KEY": apiKey,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function apiErrorMessage(body: Record<string, unknown>, status: number): string {
  return (
    (body.message as string | undefined) ??
    (body.status === "error" ? "Requisição recusada pela API." : undefined) ??
    `Erro ${status} na API Waves.`
  );
}

export async function loginApi(
  email: string,
  password: string,
  deviceName = "waves-react-web",
) {
  const cfg = getEnvConfig();

  if (!cfg.url || !cfg.token) {
    throw new Error("Credenciais Waves não configuradas no .env.");
  }

  const response = await fetch(`${cfg.url}/login`, {
    method: "POST",
    headers: authHeaders(cfg.token),
    credentials: "include",
    body: JSON.stringify({
      email,
      password,
      device_name: deviceName,
    }),
  });

  const body = await parseJson<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error(apiErrorMessage(body, response.status));
  }

  const data = body.data as {
    token?: {
      access_token?: string;
      expires_in?: number;
      expires_at?: string;
    };
    user?: WavesUser;
    roles?: string[];
    effective_permissions?: string[];
    permissions_version?: string;
  };

  if (!data?.token?.access_token || !data.user) {
    throw new Error("Resposta de login incompleta.");
  }

  const result: LoginResult = {
    accessToken: data.token.access_token,
    expiresIn: data.token.expires_in ?? 86400,
    user: data.user,
    roles: Array.isArray(data.roles) ? data.roles : [],
    effectivePermissions: Array.isArray(data.effective_permissions)
      ? data.effective_permissions
      : [],
    permissionsVersion:
      typeof data.permissions_version === "string"
        ? data.permissions_version
        : undefined,
    // Aceita `agents` ou `assistants` na response do /login (a Waves expõe
    // um dos dois conforme versão). Normaliza pra `agents` na sessão.
    agents: extractAgentsFromLogin(data),
  };

  return result;
}

function extractAgentsFromLogin(data: Record<string, unknown>): LoginResult["agents"] {
  const raw = data.agents ?? data.assistants;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is { id: number } =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as { id?: unknown }).id === "number",
  ) as LoginResult["agents"];
}

export async function fetchWorkflowsApi(accessToken: string): Promise<WorkflowsResponse> {
  const cfg = getEnvConfig();
  const perPage = 100;

  async function fetchPage(page: number) {
    const response = await fetch(`${cfg.url}${buildWorkflowsListPath(page, perPage)}`, {
      method: "GET",
      headers: authHeaders(cfg.token, accessToken),
      credentials: "include",
    });

    const body = await parseJson<Record<string, unknown>>(response);

    if (!response.ok) {
      throw new Error(apiErrorMessage(body, response.status));
    }

    return body;
  }

  const firstPage = await fetchPage(1);
  const meta = extractWorkflowPagination(firstPage);
  const pages: unknown[] = [firstPage];

  if (meta && meta.lastPage > 1) {
    for (let page = 2; page <= meta.lastPage; page++) {
      pages.push(await fetchPage(page));
    }
  }

  return buildWorkflowsListResult(pages) as WorkflowsResponse;
}

function extractAssistants(body: Record<string, unknown>): AssistantItem[] {
  const data = body.data as { assistants?: unknown } | undefined;
  if (Array.isArray(data?.assistants)) {
    return data.assistants as AssistantItem[];
  }
  if (Array.isArray(body.assistants)) {
    return body.assistants as AssistantItem[];
  }
  return [];
}

export async function fetchAssistantsApi(
  accessToken: string,
): Promise<AssistantItem[]> {
  const cfg = getEnvConfig();
  const response = await fetch(`${cfg.url}/assistants`, {
    method: "GET",
    headers: authHeaders(cfg.token, accessToken),
    credentials: "include",
  });

  const body = await parseJson<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error(apiErrorMessage(body, response.status));
  }

  return extractAssistants(body);
}

function extractBookings(body: Record<string, unknown>): BookingItem[] {
  const data = body.data as { bookings?: unknown } | undefined;
  if (Array.isArray(data?.bookings)) {
    return data.bookings as BookingItem[];
  }
  if (Array.isArray(body.bookings)) {
    return body.bookings as BookingItem[];
  }
  return [];
}

export async function fetchBookingsApi(accessToken: string): Promise<BookingItem[]> {
  const cfg = getEnvConfig();
  const response = await fetch(`${cfg.url}/bookings`, {
    method: "GET",
    headers: authHeaders(cfg.token, accessToken),
    credentials: "include",
  });

  const body = await parseJson<Record<string, unknown>>(response);

  if (!response.ok) {
    throw new Error(apiErrorMessage(body, response.status));
  }

  return extractBookings(body);
}

// === Funnels ================================================================
// `/funnels` não existe (404). Funis vivem em `/assistants/{id}/funnel` (1:1).
// O payload cru tem stages com `prompt`, `behaviour`, `context_message`, etc —
// reduzimos pra slim aqui mesmo antes de empacotar no UserScope.

function slimFunnelStage(raw: Record<string, unknown>): FunnelStageItem {
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

function slimFunnel(
  raw: Record<string, unknown>,
  assistantId: number,
): FunnelItem {
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

export async function fetchAssistantFunnelApi(
  accessToken: string,
  assistantId: number,
): Promise<FunnelItem | null> {
  const cfg = getEnvConfig();
  const response = await fetch(`${cfg.url}/assistants/${assistantId}/funnel`, {
    method: "GET",
    headers: authHeaders(cfg.token, accessToken),
    credentials: "include",
  });

  if (response.status === 404) return null;

  const body = await parseJson<Record<string, unknown>>(response);

  if (!response.ok) {
    // 403/401 = sem permissão → comporta como "sem funnel" pra não derrubar o login
    return null;
  }

  const data = body.data as { funnel?: Record<string, unknown> } | undefined;
  const funnel = data?.funnel;
  if (!funnel) return null;
  return slimFunnel(funnel, assistantId);
}

/**
 * Verifica se a session ainda é válida no servidor Babble.
 *
 * **Política de invalidação (intencionalmente leniente):**
 *  - Token expirado localmente (`expiresAt`) → invalida
 *  - Erro HTTP **401/403** (auth de fato negada) → invalida
 *  - Outros erros (429 throttle, 5xx, network/timeout, CORS) → mantém
 *    session válida. São transitórios — derrubar a session por causa de
 *    rate-limit/intermitência fazia o user ser deslogado em cada refresh.
 *
 * O usuário continua usando o app; se o token estiver REALMENTE morto, a
 * próxima request real vai falhar 401 e o cliente individual lida com isso.
 */
export async function verifyApiSession(session: AuthSession): Promise<boolean> {
  // 1. Expiração local (barata, sem rede): token já vencido → inválido.
  if (typeof session.expiresAt === "number" && Date.now() >= session.expiresAt) {
    return false;
  }
  // 2. Validação server-side via proxy (/api/waves/user injeta o X-API-KEY do
  //    tenant). Só 401/403 (auth de fato negada) invalida; erros transitórios
  //    (429/5xx/network/timeout) mantêm a sessão — política intencionalmente
  //    leniente pra não deslogar em intermitência.
  const cfg = getEnvConfig();
  if (!cfg.url) return true; // sem URL configurada → não dá pra validar; mantém
  try {
    const response = await fetch(`${cfg.url}/user`, {
      method: "GET",
      headers: authHeaders(cfg.token, session.accessToken),
      credentials: "include",
    });
    if (response.status === 401 || response.status === 403) return false;
    return true;
  } catch {
    return true; // erro transitório/rede — mantém a sessão
  }
}
