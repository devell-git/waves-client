export type WavesEnvironment = "dev" | "prod";

export interface WavesUser {
  id: number;
  name: string;
  email: string;
  type?: string;
  avatar?: string;
}

export type AgentItem = {
  id: number;
  name?: string;
  title?: string;
  description?: string | null;
  /** Profile Hermes do agente (ex.: "bioshield-steve", "waves-cfo"). */
  profile_name?: string;
  /** Host do gateway (re-registrado pelo Hermes ao subir). */
  host?: string;
  /** Porta do gateway — usada pra casar o agente com o profile roteável. */
  port?: number;
  /** Starters da plataforma (botões de conversa). Cada item: {label, prompt, icon}.
   *  `null` ou array vazio/sem label quando não cadastrado na Waves. */
  starters?: unknown[] | null;
  /** Título/subtítulo da página do agente (cadastrados na Waves). */
  page_title?: string;
  page_subtitle?: string;
  /** Política de reasoning do agente (cadastrada na Waves):
   *  - "On": sempre usa reasoning (aprofundado), SEM mostrar o botão.
   *  - "Off": nunca usa reasoning (rápido), SEM mostrar o botão.
   *  - "Selectable": mostra o botão; default desligado (rápido). */
  reasoning?: "On" | "Off" | "Selectable" | string | null;
  /** Tipos de documento (DocumentType) que ESTE agente pode gerar — escopo
   *  vindo do login. Usado pra escolher o `document_type_id` na criação de
   *  documentos (1 → usa direto; >1 → o usuário escolhe num select). NUNCA
   *  hardcodar o tipo: o modelo/nomenclatura do PDF vem do DocumentType. */
  document_type_ids?: number[];
  /** Relação expandida do mesmo escopo (cada item tem ao menos `id`). */
  document_types?: Array<{ id: number; name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: WavesUser;
  roles: string[];
  effectivePermissions: string[];
  permissionsVersion?: string;
  /** Agentes a que o user tem acesso — vêm direto na response do POST /login,
   *  sem fetch adicional. Usados no escopo da conversa. */
  agents: AgentItem[];
}

export interface AuthSession {
  environment: WavesEnvironment;
  accessToken: string;
  expiresAt: number;
  user: WavesUser;
  roles: string[];
  effectivePermissions: string[];
  permissionsVersion?: string;
  agents: AgentItem[];
  /** Tenant (resolvido por host) ao qual a sessão pertence. Vincula threads. */
  tenant?: string;
}

export type WorkflowItem = {
  id: number;
  name: string;
  description?: string | null;
  color?: string;
  board_id?: number;
  created_at?: string;
  [key: string]: unknown;
};

export type AssistantItem = {
  id: number;
  name?: string;
  title?: string;
  description?: string | null;
  [key: string]: unknown;
};

export type BookingItem = {
  id: number;
  booking_name?: string;
  name?: string;
  title?: string;
  [key: string]: unknown;
};

export type FunnelStageItem = {
  id: number;
  name: string | null;
  color: string | null;
  order: number | null;
  parent_id: number | null;
  hidden: boolean;
  has_behaviour: boolean;
  has_form: boolean;
};

export type FunnelItem = {
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
  stages: FunnelStageItem[];
};

export interface WorkflowsResponse {
  status?: string;
  data?: {
    workflows?: WorkflowItem[];
    pagination?: {
      currentPage: number;
      lastPage: number;
      perPage: number;
      total: number | null;
    };
  };
}

export interface AssistantsResponse {
  status?: string;
  data?: {
    assistants?: AssistantItem[];
    [key: string]: unknown;
  };
}
