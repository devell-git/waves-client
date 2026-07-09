/**
 * Módulo input-form — renderização de formulários de agente (schema jQuery
 * FormBuilder) em React, e montagem do contexto/kickoff da 1ª mensagem.
 *
 * API pública (única porta de entrada do módulo): consumidores importam SÓ daqui.
 */
export { InputForm } from "./InputForm";
export type { InputFormProps } from "./InputForm";

export { parseInputForm, hasRenderableForm } from "./schema";
export type {
  ParsedInputForm,
  NormalizedField,
  FormOption,
  FieldRole,
} from "./schema";

export { buildKickoffMessage } from "./context";
export type {
  FormValue,
  FormValues,
  InputFormContext,
  AiTargetSpec,
  UserInput,
  KickoffMessage,
} from "./context";

export {
  useInputFormGate,
  resolveAgentInputForm,
  mockInputFormSchema,
} from "./use-input-form-gate";
