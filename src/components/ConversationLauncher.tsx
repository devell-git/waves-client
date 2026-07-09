/**
 * Gate de abertura de conversa: quando o agente tem `input_form` e o chat está
 * vazio, renderiza o formulário DENTRO de um balão de mensagem do assistente
 * (no fluxo normal da thread). Ao submeter, o balão some e a 1ª mensagem do
 * usuário entra na mesma área — sensação de continuidade, sem overlay.
 */
import { useState, type ReactNode } from "react";
import { useThread } from "@openuidev/react-headless";
import type { AgentItem } from "../types/auth";
import {
  InputForm,
  buildKickoffMessage,
  type FormValues,
  type ParsedInputForm,
} from "../modules/input-form";
import { useInputFormGate } from "../modules/input-form/use-input-form-gate";

export function ConversationLauncher({ agent }: { agent?: AgentItem }) {
  const processMessage = useThread((s) => s.processMessage);
  const { pending, parsed, submitLabel } = useInputFormGate(agent);
  const [busy, setBusy] = useState(false);

  if (!pending || !parsed) return null;

  const handleSubmit = (values: FormValues, p: ParsedInputForm) => {
    if (busy) return;
    setBusy(true);
    const { content } = buildKickoffMessage(p, values);
    processMessage({ role: "user", content });
  };

  return (
    <div className="openui-shell-thread-message-assistant openui-shell-thread-message-assistant--without-logo waves-assistant-message waves-input-form-message">
      <div className="openui-shell-thread-message-assistant__content waves-input-form-message__bubble">
        <InputForm
          parsed={parsed}
          variant="bubble"
          title={agent?.page_title}
          subtitle={agent?.page_subtitle}
          submitLabel={submitLabel}
          busy={busy}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

/** Esconde o composer enquanto o form obrigatório não foi enviado. */
export function InputFormComposerGate({
  agent,
  children,
}: {
  agent?: AgentItem;
  children: ReactNode;
}) {
  const { pending } = useInputFormGate(agent);
  if (pending) return null;
  return <>{children}</>;
}

/** Esconde a welcome area quando o form gate está ativo (evita duplicar título). */
export function useInputFormGatePending(agent?: AgentItem): boolean {
  return useInputFormGate(agent).pending;
}
