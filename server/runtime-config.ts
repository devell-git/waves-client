/**
 * Config de runtime (starters fallback, mapa porta↔profile).
 *
 * Hoje vem de constantes locais — ponto único pra futura troca por pull da
 * Config API (integration-core / waves-core) sem espalhar hardcodes no index.
 */

export interface ProfileStarterFormField {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email";
  required?: boolean;
}

export interface ProfileStarter {
  displayText: string;
  prompt: string;
  formFields?: ProfileStarterFormField[];
  submitPromptTemplate?: string;
}

/** Starters fallback por PORTA de gateway (quando agent.starters não vem do login). */
export const PROFILE_STARTERS: Record<string, ProfileStarter[]> = {
  "18860": [
    {
      displayText: "Action Plans abertos",
      prompt: "Liste todos os Action Plans abertos hoje, com responsável e estágio. Use dashboard visual.",
    },
    {
      displayText: "Status do projeto",
      prompt: "Me dá um overview do BIOSHIELD agora: fase, frentes ativas, próximos marcos.",
    },
    {
      displayText: "Tarefas críticas",
      prompt: "Quais são as tasks de maior prioridade ou em atraso nos Action Plans?",
    },
    {
      displayText: "Funil de captação",
      prompt: "Mostra o estado atual do funil de captação e investimento do projeto.",
    },
  ],
  "18862": [
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
  ],
  "18864": [
    { displayText: "Consultar CPF", prompt: "__form_cpf__" },
    { displayText: "Consultar CNPJ", prompt: "__form_cnpj__" },
  ],
};

export const PROFILE_NAMES: Record<string, string> = {
  "18860": "bioshield-steve",
  "18862": "ybrax-negative-media",
  "18864": "ybrax-verifique",
};

export const PROFILE_ID_TO_PORT: Record<string, string> = {
  "bioshield-steve": "18860",
  "ybrax-negative-media": "18862",
  "ybrax-verifique": "18864",
};

export function detectProfile(requestedId?: string) {
  let port: string;
  if (requestedId && PROFILE_ID_TO_PORT[requestedId]) {
    port = PROFILE_ID_TO_PORT[requestedId];
  } else {
    const baseURL = process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:18862/v1";
    const m = baseURL.match(/:(\d+)/);
    port = m ? m[1] : "18862";
  }
  return {
    id: PROFILE_NAMES[port] ?? `unknown-${port}`,
    port,
    starters: PROFILE_STARTERS[port] ?? [],
  };
}
