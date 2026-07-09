/**
 * Parser/normalizador do schema de `input_form` do agente (padrão jQuery
 * FormBuilder, cadastrado na Waves e entregue no login em `AgentItem.input_form`).
 *
 * O WebApp é React (sem jQuery): aqui transformamos o JSON cru do FormBuilder
 * numa estrutura normalizada que o renderer React consome, e classificamos cada
 * campo em:
 *   - presentational  → header/paragraph/break/button (não é input; button é
 *                        ação do FormBuilder e é ignorado no render).
 *   - input + "user"  → o USUÁRIO preenche (render normal).
 *   - input + "ai-target" → gerado pelo AGENTE (className contém `ai-target`).
 *                        NÃO é renderizado; vai pro <context> (label + prompt +
 *                        values/limites) instruindo o agente sobre o que produzir.
 *
 * Envelope tolerante: aceita array, array-de-array (`[[...]]`), string JSON ou
 * `{ fields: [...] }` / `{ form: [...] }`.
 */

export interface FormOption {
  label: string;
  value: string;
  selected?: boolean;
}

export type FieldRole = "user" | "ai-target";

export interface NormalizedField {
  /** input = campo de dado; presentational = header/paragraph/break/button. */
  kind: "input" | "presentational";
  /** Só relevante em kind="input". */
  role: FieldRole;
  /** Tipo bruto do FormBuilder (text/date/number/textarea/select/autocomplete/...). */
  type: string;
  subtype?: string;
  /** Nome do campo (chave nos dados). Vazio em presentational sem name. */
  name: string;
  /** Label já com HTML-entities/&nbsp;/tags removidos. */
  label: string;
  required: boolean;
  readonly: boolean;
  multiple: boolean;
  /** Opções (select/autocomplete/radio-group/checkbox-group). */
  options: FormOption[];
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  maxlength?: number;
  /** Default: `selected` das options (array se multiple) ou atributo `value`. */
  defaultValue?: string | string[];
  /** Instrução pro agente gerar o campo (só em ai-target; opcional). */
  prompt?: string;
  /** Largura em grid de 12 colunas (1..12; default 12). */
  column: number;
  /** Objeto cru original (fallback pra campos não previstos). */
  raw: Record<string, unknown>;
}

export interface ParsedInputForm {
  fields: NormalizedField[];
  /** Inputs que o usuário preenche (render). */
  userFields: NormalizedField[];
  /** Inputs gerados pelo agente (vão pro contexto, não pro render). */
  aiTargets: NormalizedField[];
  /** Texto do botão de submit (vem do envelope do form ou do agente). */
  submitButtonText?: string;
}

const PRESENTATIONAL = new Set(["header", "paragraph", "break", "hr", "button"]);

/** Remove HTML entities/tags comuns do label (`Data&nbsp;`, `<b>x</b>`). */
function cleanLabel(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function toNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isAiTarget(className: unknown): boolean {
  return typeof className === "string" && /\bai-target\b/.test(className);
}

function normalizeOptions(values: unknown): FormOption[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      return {
        label: cleanLabel(o.label) || String(o.value ?? ""),
        value: String(o.value ?? ""),
        selected: o.selected === true,
      };
    })
    .filter((o) => o.value !== "" || o.label !== "");
}

interface UnwrappedForm {
  fields: unknown[];
  submitButtonText?: string;
}

function readSubmitButtonText(o: Record<string, unknown>): string | undefined {
  const t = o.submit_button_text;
  return typeof t === "string" && t.trim() ? t.trim() : undefined;
}

/** Extrai campos + submit_button_text do envelope (tolerante a variações). */
function unwrap(input: unknown): UnwrappedForm | null {
  let v = input;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) {
    // `[[...]]` — array-de-array: usa o interno se o externo tiver 1 array.
    if (v.length === 1 && Array.isArray(v[0])) {
      return { fields: v[0] as unknown[] };
    }
    return { fields: v as unknown[] };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const submitButtonText = readSubmitButtonText(o);
    if (Array.isArray(o.fields)) {
      return { fields: o.fields as unknown[], submitButtonText };
    }
    if (Array.isArray(o.form)) {
      return { fields: o.form as unknown[], submitButtonText };
    }
  }
  return null;
}

function normalizeField(raw: Record<string, unknown>): NormalizedField {
  const type = String(raw.type ?? "");
  const options = normalizeOptions(raw.values);
  const multiple = raw.multiple === true;

  // Default: options `selected` (array se multiple) ou atributo `value`.
  let defaultValue: string | string[] | undefined;
  const selected = options.filter((o) => o.selected).map((o) => o.value);
  if (selected.length) {
    defaultValue = multiple ? selected : selected[0];
  } else if (raw.value != null && raw.value !== "") {
    defaultValue = String(raw.value);
  }

  const columnRaw = toNum(raw.column);
  const column = columnRaw && columnRaw >= 1 && columnRaw <= 12 ? columnRaw : 12;

  const kind = PRESENTATIONAL.has(type) ? "presentational" : "input";
  const role: FieldRole = isAiTarget(raw.className) ? "ai-target" : "user";

  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : undefined;

  return {
    kind,
    role,
    type,
    subtype: typeof raw.subtype === "string" ? raw.subtype : undefined,
    name: String(raw.name ?? ""),
    label: cleanLabel(raw.label),
    required: raw.required === true,
    readonly: raw.readonly === true,
    multiple,
    options,
    rows: toNum(raw.rows),
    min: toNum(raw.min),
    max: toNum(raw.max),
    step: toNum(raw.step),
    maxlength: toNum(raw.maxlength),
    defaultValue,
    prompt,
    column,
    raw,
  };
}

/** Parseia o schema cru → estrutura normalizada, ou null se inválido/vazio. */
export function parseInputForm(input: unknown): ParsedInputForm | null {
  const unwrapped = unwrap(input);
  if (!unwrapped || unwrapped.fields.length === 0) return null;

  const fields = unwrapped.fields
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map(normalizeField);

  if (fields.length === 0) return null;

  // Input só conta como "campo" se tiver name (button/header/etc. não têm).
  const inputs = fields.filter((f) => f.kind === "input" && f.name);
  return {
    fields,
    userFields: inputs.filter((f) => f.role === "user"),
    aiTargets: inputs.filter((f) => f.role === "ai-target"),
    submitButtonText: unwrapped.submitButtonText,
  };
}

/** `true` se o agente tem um input_form utilizável (ao menos 1 campo). */
export function hasRenderableForm(parsed: ParsedInputForm | null): boolean {
  return !!parsed && parsed.fields.some((f) => f.kind === "input" && f.name);
}
