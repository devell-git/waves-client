/**
 * Renderer React do `input_form` do agente (schema jQuery FormBuilder), SEM
 * jQuery. Renderiza só os campos do USUÁRIO (os `ai-target` são gerados pelo
 * agente e não aparecem). Presentational (header/paragraph/break) dão estrutura;
 * `button` do FormBuilder é ignorado.
 *
 * Desacoplado do chat: recebe o schema e devolve os valores no `onSubmit`. Quem
 * decide o que fazer com os valores (auto-send, etc.) é o consumidor.
 */
import { useMemo, useState } from "react";
import "./InputForm.css";
import { parseInputForm, type NormalizedField, type ParsedInputForm } from "./schema";
import type { FormValue, FormValues } from "./context";

export interface InputFormProps {
  /** Schema cru do FormBuilder. Alternativamente, passe `parsed`. */
  schema?: unknown;
  parsed?: ParsedInputForm;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  /** `bubble` = compacto dentro de balão de mensagem na thread. */
  variant?: "default" | "bubble";
  /** Desabilita o submit (ex.: enquanto o kickoff está sendo enviado). */
  busy?: boolean;
  onSubmit: (values: FormValues, parsed: ParsedInputForm) => void;
}

function initialValues(parsed: ParsedInputForm): FormValues {
  const v: FormValues = {};
  for (const f of parsed.userFields) {
    if (f.defaultValue != null) v[f.name] = f.defaultValue;
    else v[f.name] = f.multiple ? [] : "";
  }
  return v;
}

function isEmpty(v: FormValue | undefined): boolean {
  if (v == null) return true;
  return Array.isArray(v) ? v.length === 0 : String(v).trim() === "";
}

export function InputForm({
  schema,
  parsed: parsedProp,
  title,
  subtitle,
  submitLabel = "Continuar",
  variant = "default",
  busy = false,
  onSubmit,
}: InputFormProps) {
  const parsed = useMemo(
    () => parsedProp ?? parseInputForm(schema),
    [parsedProp, schema],
  );

  const [values, setValues] = useState<FormValues>(() =>
    parsed ? initialValues(parsed) : {},
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  if (!parsed) return null;

  const setValue = (name: string, value: FormValue) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: false } : prev));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const nextErrors: Record<string, boolean> = {};
    for (const f of parsed.userFields) {
      if (f.required && isEmpty(values[f.name])) nextErrors[f.name] = true;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    onSubmit(values, parsed);
  };

  return (
    <form
      className={`wif${variant === "bubble" ? " wif--bubble" : ""}`}
      onSubmit={handleSubmit}
      noValidate
    >
      {(title || subtitle) && (
        <div className="wif__head">
          {title && <h2 className="wif__title">{title}</h2>}
          {subtitle && <p className="wif__subtitle">{subtitle}</p>}
        </div>
      )}

      <div className="wif__grid">
        {parsed.fields.map((f, i) => {
          if (f.kind === "presentational") return renderPresentational(f, i);
          if (f.role === "ai-target") return null; // gerado pelo agente
          return (
            <FieldControl
              key={f.name || i}
              field={f}
              value={values[f.name]}
              error={!!errors[f.name]}
              onChange={(v) => setValue(f.name, v)}
            />
          );
        })}
      </div>

      <div className="wif__actions">
        <button type="submit" className="wif__submit" disabled={busy}>
          {busy ? "Enviando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function renderPresentational(f: NormalizedField, i: number) {
  const span = { gridColumn: `span ${f.column}` };
  switch (f.type) {
    case "header":
      return (
        <h3 key={i} className="wif__header" style={span}>
          {f.label}
        </h3>
      );
    case "paragraph":
      return (
        <p key={i} className="wif__paragraph" style={span}>
          {f.label}
        </p>
      );
    case "break":
    case "hr":
      return <hr key={i} className="wif__break" style={{ gridColumn: "span 12" }} />;
    default:
      return null; // button e afins → ignorados
  }
}

interface FieldControlProps {
  field: NormalizedField;
  value: FormValue | undefined;
  error: boolean;
  onChange: (v: FormValue) => void;
}

function FieldControl({ field: f, value, error, onChange }: FieldControlProps) {
  const id = `wif-${f.name}`;
  const disabled = f.readonly;
  const single = typeof value === "string" ? value : "";
  const multi = Array.isArray(value) ? value : [];

  return (
    <div
      className={`wif__field${error ? " wif__field--error" : ""}`}
      style={{ gridColumn: `span ${f.column}` }}
    >
      {f.label && (
        <label className="wif__label" htmlFor={id}>
          {f.label}
          {f.required && <span className="wif__req" aria-hidden="true"> *</span>}
        </label>
      )}
      {renderControl()}
      {error && <span className="wif__error-msg">Campo obrigatório</span>}
    </div>
  );

  function renderControl() {
    switch (f.type) {
      case "textarea":
        return (
          <textarea
            id={id}
            className="wif__control"
            rows={f.rows ?? 4}
            maxLength={f.maxlength}
            required={f.required}
            disabled={disabled}
            value={single}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "select":
      case "autocomplete":
        if (f.multiple) {
          return (
            <div className="wif__checks" role="group" aria-labelledby={id}>
              {f.options.map((o) => {
                const checked = multi.includes(o.value);
                return (
                  <label key={o.value} className="wif__check">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={checked}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...multi, o.value]
                            : multi.filter((v) => v !== o.value),
                        )
                      }
                    />
                    <span>{o.label}</span>
                  </label>
                );
              })}
            </div>
          );
        }
        return (
          <select
            id={id}
            className="wif__control"
            required={f.required}
            disabled={disabled}
            value={single}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Selecione…</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );

      case "radio-group":
        return (
          <div className="wif__checks" role="radiogroup" aria-labelledby={id}>
            {f.options.map((o) => (
              <label key={o.value} className="wif__check">
                <input
                  type="radio"
                  name={f.name}
                  disabled={disabled}
                  checked={single === o.value}
                  onChange={() => onChange(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        );

      case "checkbox-group":
        return (
          <div className="wif__checks" role="group" aria-labelledby={id}>
            {f.options.map((o) => {
              const checked = multi.includes(o.value);
              return (
                <label key={o.value} className="wif__check">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...multi, o.value]
                          : multi.filter((v) => v !== o.value),
                      )
                    }
                  />
                  <span>{o.label}</span>
                </label>
              );
            })}
          </div>
        );

      case "number":
        return (
          <input
            id={id}
            type="number"
            className="wif__control"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            required={f.required}
            disabled={disabled}
            value={single}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "date":
        return (
          <input
            id={id}
            type="date"
            className="wif__control"
            required={f.required}
            disabled={disabled}
            value={single}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      default:
        // text e qualquer input textual não previsto.
        return (
          <input
            id={id}
            type={f.subtype === "email" ? "email" : "text"}
            className="wif__control"
            maxLength={f.maxlength}
            required={f.required}
            disabled={disabled}
            value={single}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  }
}
