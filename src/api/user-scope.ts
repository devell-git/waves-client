/**
 * Escopo do usuário (versão minimalista — 2026-05-26).
 *
 * Antes este módulo carregava no boot do chat:
 *   - GET /workflows (lista de workflows visíveis)
 *   - GET /assistants (lista de assistentes)
 *   - GET /bookings (lista de agendas)
 *   - 1× GET /assistants/:id/funnel POR ASSISTANT
 *
 * Para users com muitos assistants/workflows isso disparava dezenas ou
 * centenas de chamadas paralelas à Waves API, gerava 429s, saturava o
 * connection pool do browser e fazia o /api/chat ficar `Pending` por minutos.
 *
 * Decisão: o agente busca esses dados sob demanda quando precisa
 * (`list_workflows`, `list_assistants`, `get_workflow_kanban`, etc.). O
 * frontend não pré-carrega nada. Inventário no boot = zero.
 *
 * O que sobra aqui é só o que vem do login (POST /login → persona, roles,
 * effective_permissions) — informação leve, já em memória.
 */
import { derivePersona, type UserPersona } from "../lib/permissions";
import type { AgentItem, AuthSession } from "../types/auth";

export interface UserScope {
  persona: UserPersona;
  roles: string[];
  effectivePermissions: string[];
  /** Agentes a que o user tem acesso — vêm da response do POST /login,
   *  já em memória. Zero fetch adicional. */
  agents: AgentItem[];
  fetchedAt: number;
}

export async function fetchUserScope(session: AuthSession): Promise<UserScope> {
  return {
    persona: derivePersona(session.effectivePermissions),
    roles: session.roles,
    effectivePermissions: session.effectivePermissions,
    agents: session.agents ?? [],
    fetchedAt: Date.now(),
  };
}

export function buildConversationStarters(_scope: UserScope) {
  // O agente conhece a plataforma e busca dados sob demanda. Starters
  // específicos por inventário (kanban X, funnel Y) eram baseados em pré-load
  // — agora ficam só os genéricos.
  return {
    variant: "long" as const,
    options: [
      {
        displayText: "O que posso fazer aqui?",
        prompt:
          "Explique em TextContent e Card quais áreas da Waves costumam existir (workflows, assistentes, campanhas) e convide o usuário a descrever o que precisa. FollowUpBlock.",
      },
    ],
  };
}

export function buildWelcomeMessage(scope: UserScope | null) {
  if (!scope) {
    return {
      title: "Como posso ajudar?",
      description: "Carregando seu perfil…",
    };
  }
  return {
    title: "Como posso ajudar?",
    description: "Descreva o que você precisa na plataforma Waves.",
  };
}

export function formatScopeMeta(scope: UserScope): string {
  return `${scope.persona} · ${scope.roles.length} role(s) · ${scope.effectivePermissions.length} permissão(ões)`;
}
