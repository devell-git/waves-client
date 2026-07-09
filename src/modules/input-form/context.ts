/**
 * Monta a 1ª mensagem (auto-send) a partir do input_form preenchido.
 *
 * Regra combinada:
 *   - VISÍVEL: só os campos que o USUÁRIO preencheu (label: valor legível).
 *   - <context>: dois blocos —
 *       user_inputs  → o que o usuário informou (name/label/value);
 *       ai_targets   → campos com classe `ai-target` que o AGENTE deve GERAR,
 *                      cada um com label, prompt (quando houver), valores
 *                      permitidos (values) e limites (min/max/maxlength).
 *
 * Reusa a convenção `<content>…</content><context>…</context>` que o pipeline e
 * o UserMessageView já entendem (a tag <context> é escondida na exibição).
 */
import type { NormalizedField, ParsedInputForm } from "./schema";

export type FormValue = string | string[];
export type FormValues = Record<string, FormValue>;

export interface AiTargetSpec {
  name: string;
  label: string;
  type: string;
  prompt?: string;
  allowed_values?: string[];
  multiple?: boolean;
  min?: number;
  max?: number;
  maxlength?: number;
}

export interface UserInput {
  name: string;
  label: string;
  value: FormValue;
}

export interface InputFormContext {
  user_inputs: UserInput[];
  ai_targets: AiTargetSpec[];
}

/** Label legível de um valor, resolvendo options (value→label) e multi. */
function displayValue(field: NormalizedField, value: FormValue): string {
  const resolve = (v: string): string =>
    field.options.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(resolve).join(", ");
  return resolve(value);
}

function aiTargetSpec(f: NormalizedField): AiTargetSpec {
  const spec: AiTargetSpec = { name: f.name, label: f.label, type: f.type };
  if (f.prompt) spec.prompt = f.prompt;
  if (f.options.length) spec.allowed_values = f.options.map((o) => o.value);
  if (f.multiple) spec.multiple = true;
  if (f.min != null) spec.min = f.min;
  if (f.max != null) spec.max = f.max;
  if (f.maxlength != null) spec.maxlength = f.maxlength;
  return spec;
}

export interface KickoffMessage {
  /** Texto visível na bolha do usuário. */
  visible: string;
  /** Payload que vai no <context>. */
  context: InputFormContext;
  /** Mensagem final pronta pro processMessage (content + context). */
  content: string;
}

/** Constrói a mensagem de kickoff (auto-send) do input_form. */
export function buildKickoffMessage(
  parsed: ParsedInputForm,
  values: FormValues,
): KickoffMessage {
  const userInputs: UserInput[] = parsed.userFields
    .map((f) => ({ name: f.name, label: f.label, value: values[f.name] ?? "" }))
    .filter((u) => (Array.isArray(u.value) ? u.value.length > 0 : String(u.value).trim() !== ""));

  const visibleLines = userInputs.map((u) => {
    const field = parsed.userFields.find((f) => f.name === u.name)!;
    return `${u.label}: ${displayValue(field, u.value)}`;
  });
  const visible = visibleLines.join("\n");

  const context: InputFormContext = {
    user_inputs: userInputs,
    ai_targets: parsed.aiTargets.map(aiTargetSpec),
  };

  const contentPart = visible ? `<content>${visible}</content>` : "";
  const content = `${contentPart}<context>${JSON.stringify(context)}</context>`;

  return { visible, context, content };
}
