import type { WavesSession } from "../waves-client.js";

// Tipos do escopo enviado pelo frontend pós-login. Lista TUDO que o user vê
// na plataforma — fica embutido no system prompt pra agente ter awareness
// sem precisar chamar tools pra perguntas básicas de inventário.
export interface UserInfo {
  id?: number | string;
  name?: string;
  email?: string;
  type?: string;
}

export interface ScopeWorkflow {
  id: number;
  name?: string | null;
  title?: string | null;
  description?: string | null;
}

export interface ScopeAssistant {
  id: number;
  name?: string | null;
  title?: string | null;
}

export interface ScopeBooking {
  id: number;
  name?: string | null;
  title?: string | null;
  booking_name?: string | null;
}

export interface ScopeFunnelStage {
  id: number;
  name?: string | null;
  color?: string | null;
  order?: number | null;
  parent_id?: number | null;
  hidden?: boolean;
  has_form?: boolean;
}

export interface ScopeFunnel {
  id: number;
  name?: string | null;
  description?: string | null;
  assistant_id: number;
  workflow_id?: number | null;
  stages_count?: number;
  stages?: ScopeFunnelStage[];
}

export interface UserScopePayload {
  workflows: ScopeWorkflow[];
  assistants: ScopeAssistant[];
  bookings: ScopeBooking[];
  funnels?: ScopeFunnel[];
  defaultWorkflowId?: number | null;
  defaultAssistantId?: number | null;
  defaultBookingId?: number | null;
  fetchedAt?: number;
}

export interface ChatRequestBody {
  messages: unknown[];
  /**
   * ID do profile Hermes ativo (ex.: `ybrax-negative-media`, `ybrax-map`).
   * Default = `ybrax-negative-media`. Define qual gateway recebe a request.
   */
  profile?: string;
  /** Host do gateway do agente (vindo do LOGIN). Só é usado se estiver na
   *  allowlist HERMES_ALLOWED_HOSTS; caso contrário cai em 127.0.0.1 (gateways
   *  co-locados fazem bind em loopback). */
  host?: string;
  /** Porta do gateway do agente (vinda do LOGIN). Determina qual gateway recebe. */
  port?: number;
  /**
   * UUID curto da thread/conversa atual. Quando presente, vira sufixo do
   * sessionId enviado pro Hermes (`waves-user-1::<threadId>`), permitindo
   * múltiplas conversas paralelas por user. Ausente = mantém comportamento
   * legacy (`waves-user-1` ou `waves-anon` flat).
   */
  threadId?: string;
  /** Esforço de reasoning do modelo p/ esta conversa: "none" (rápido) ou
   *  "medium" (aprofundado). Vira o header X-Hermes-Reasoning-Effort. Ausente =
   *  usa o reasoning_effort do config.yaml do profile. */
  reasoningEffort?: string;
  wavesSession?: WavesSession;
  defaultWorkflowId?: number;
  persona?: string | null;
  permissions?: string[];
  user?: UserInfo;
  roles?: string[];
  userScope?: UserScopePayload | null;
  attachments?: AttachmentPayload[];
  /** agent_id (do login) → header X-Hermes-Agent-Id pro gateway gravar na web-session. */
  agentId?: number | string;
  /** Pede o bloco de usage (tokens) no stream. Só quando admin (badge admin-only). */
  wantUsage?: boolean;
}

/**
 * Arquivo enviado pelo composer (já salvo + extraído pelo `/api/uploads`).
 * O texto extraído é injetado na última mensagem do user antes de ir pro LLM.
 */
export interface AttachmentPayload {
  filename: string;
  mimeType: string;
  kind: "pdf" | "doc" | "sheet" | "text" | "image" | "other";
  size: number;
  url: string;
  path: string;
  /** Caminho do content.txt (texto extraído salvo em disco, leitura sob demanda). */
  contentPath?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
}
