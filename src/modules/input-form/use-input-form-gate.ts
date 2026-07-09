/**
 * Hook compartilhado: o gate de input_form está ativo quando o agente tem form,
 * o chat está vazio e ainda não houve submit. Usado pelo balão do form e pra
 * esconder welcome/composer até o usuário enviar.
 */
import { useMemo } from "react";
import { useThread } from "@openuidev/react-headless";
import { isChatEmpty } from "@openuidev/react-ui";
import type { AgentItem } from "../../types/auth";
import { parseInputForm, hasRenderableForm } from "./schema";
import { SAMPLE_INPUT_FORM_ENVELOPE } from "./sample.acady";

/** QA manual — ver ConversationLauncher / sample.acady.ts */
export function mockInputFormSchema(): unknown | undefined {
  try {
    return localStorage.getItem("wif-mock") === "1" ? SAMPLE_INPUT_FORM_ENVELOPE : undefined;
  } catch {
    return undefined;
  }
}

export function resolveAgentInputForm(agent?: AgentItem): unknown {
  return agent?.input_form ?? mockInputFormSchema();
}

export function useInputFormGate(agent?: AgentItem): {
  pending: boolean;
  parsed: ReturnType<typeof parseInputForm>;
  submitLabel: string;
} {
  const messages = useThread((s) => s.messages);
  const isLoadingMessages = useThread((s) => s.isLoadingMessages);
  const raw = resolveAgentInputForm(agent);
  const parsed = useMemo(() => parseInputForm(raw), [raw]);

  const pending = !!(
    parsed &&
    hasRenderableForm(parsed) &&
    isChatEmpty({ isLoadingMessages, messages })
  );

  const submitLabel =
    parsed?.submitButtonText?.trim() ||
    agent?.submit_button_text?.trim() ||
    "Continuar";

  return { pending, parsed: pending ? parsed : null, submitLabel };
}
