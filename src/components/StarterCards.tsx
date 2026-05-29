/**
 * StarterCards — substitui o welcomeMessage default do FullScreen.
 *
 * Renderiza as opções iniciais como CARDS grandes em vez de pills/texto.
 * Suporta 2 modos por item:
 *   1. Sem `formFields` → click dispara processMessage com `prompt`
 *   2. Com `formFields` → click expande o card mostrando inputs local.
 *      Submit aplica `submitPromptTemplate` (`{{name}}` → valor) e
 *      dispara processMessage. SEM ida ao LLM antes do submit.
 *
 * Usa useThread do @openuidev/react-headless (disponível porque FullScreen
 * wrappa ChatProvider internamente).
 */
import { useThread } from "@openuidev/react-headless";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export interface StarterCardFormField {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email";
  required?: boolean;
}

export interface StarterCardItem {
  displayText: string;
  /** Prompt enviado quando NÃO tem `formFields`. */
  prompt: string;
  /** Ícone opcional (emoji ou React node). */
  icon?: ReactNode;
  /** Descrição secundária (linha abaixo do título). */
  description?: string;
  /** Quando presente, click expande o card mostrando o form local. */
  formFields?: StarterCardFormField[];
  /** Template aplicado ao submit do form. `{{name}}` substitui pelo valor. */
  submitPromptTemplate?: string;
}

function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}

interface StarterCardsProps {
  items: StarterCardItem[];
  title?: string;
  subtitle?: string;
}

export function StarterCards({ items, title, subtitle }: StarterCardsProps) {
  const { processMessage } = useThread();
  // Qual item está com form aberto (null = nenhum)
  const [openItem, setOpenItem] = useState<string | null>(null);
  // Valores do form do item aberto
  const [values, setValues] = useState<Record<string, string>>({});

  const sendPrompt = useMemo(
    () => (prompt: string) => {
      processMessage({
        role: "user",
        content: [{ type: "text", text: prompt }],
      });
    },
    [processMessage],
  );

  function handleCardClick(item: StarterCardItem) {
    if (item.formFields && item.formFields.length > 0) {
      // Toggle expansão local; reseta values quando abre
      setOpenItem((curr) => {
        const isOpening = curr !== item.displayText;
        if (isOpening) {
          const init: Record<string, string> = {};
          item.formFields!.forEach((f) => (init[f.name] = ""));
          setValues(init);
        }
        return isOpening ? item.displayText : null;
      });
    } else {
      sendPrompt(item.prompt);
    }
  }

  function handleSubmit(item: StarterCardItem, e: React.FormEvent) {
    e.preventDefault();
    const tpl = item.submitPromptTemplate ?? item.prompt;
    const prompt = applyTemplate(tpl, values);
    sendPrompt(prompt);
    setOpenItem(null);
  }

  return (
    <div className="starter-cards-wrapper">
      {(title || subtitle) && (
        <div className="starter-cards-header">
          {title && <h2 className="starter-cards-title">{title}</h2>}
          {subtitle && <p className="starter-cards-subtitle">{subtitle}</p>}
        </div>
      )}
      <div className="starter-cards-grid">
        {items.map((item) => {
          const isOpen = openItem === item.displayText;
          const hasForm = item.formFields && item.formFields.length > 0;
          return (
            <div
              key={item.displayText}
              className={`starter-card-container${isOpen ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="starter-card"
                onClick={() => handleCardClick(item)}
              >
                {item.icon && (
                  <span className="starter-card-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="starter-card-text">
                  <span className="starter-card-title">{item.displayText}</span>
                  {item.description && (
                    <span className="starter-card-desc">{item.description}</span>
                  )}
                </span>
                <span className="starter-card-arrow" aria-hidden="true">
                  {isOpen ? "▾" : "→"}
                </span>
              </button>
              {isOpen && hasForm && (
                <form
                  className="starter-card-form"
                  onSubmit={(e) => handleSubmit(item, e)}
                >
                  {item.formFields!.map((f) => (
                    <div key={f.name} className="starter-form-field">
                      <label htmlFor={`sf-${item.displayText}-${f.name}`}>
                        {f.label}
                        {f.required && <span className="starter-form-req">*</span>}
                      </label>
                      <input
                        id={`sf-${item.displayText}-${f.name}`}
                        type={f.type ?? "text"}
                        placeholder={f.placeholder}
                        required={f.required}
                        value={values[f.name] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.name]: e.target.value }))
                        }
                        autoComplete="off"
                      />
                    </div>
                  ))}
                  <div className="starter-form-actions">
                    <button type="submit" className="btn-primary">
                      Analisar
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setOpenItem(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Factory: gera um `WelcomeMessageConfig` (React.ComponentType) pré-fechado
 * com os items + textos. Use direto na prop `welcomeMessage` do FullScreen.
 */
export function makeStarterCardsWelcome(
  items: StarterCardItem[],
  opts?: { title?: string; subtitle?: string },
): React.ComponentType {
  return function StarterCardsWelcome() {
    return <StarterCards items={items} title={opts?.title} subtitle={opts?.subtitle} />;
  };
}

/**
 * Versão self-fetching: componente faz seu próprio fetch de starters do
 * /api/runtime quando monta. Evita problema de timing onde o welcomeMessage
 * é avaliado ANTES do runtime carregar.
 *
 * Suporta starters com `formFields` + `submitPromptTemplate` — click no card
 * abre form local sem ida ao LLM, submit aplica template + dispara message.
 */
export function makeDynamicStarterCardsWelcome(
  fallback: StarterCardItem[],
  iconOf: (displayText: string) => ReactNode,
  opts?: { title?: string; subtitle?: string; profileId?: string },
): React.ComponentType {
  return function DynamicStarterCardsWelcome() {
    const [items, setItems] = useState<StarterCardItem[]>(fallback);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      let cancelled = false;
      const url = opts?.profileId
        ? `/api/runtime?profile=${encodeURIComponent(opts.profileId)}`
        : "/api/runtime";
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          const starters = (data?.defaultStarters ?? []) as Array<{
            displayText: string;
            prompt: string;
            formFields?: StarterCardFormField[];
            submitPromptTemplate?: string;
          }>;
          if (starters.length > 0) {
            setItems(
              starters.map((s) => ({
                displayText: s.displayText,
                prompt: s.prompt,
                icon: iconOf(s.displayText),
                // NÃO derivar description do prompt — prompt pode conter
                // instruções internas. Só usa description se vier explícito
                // do server.
                formFields: s.formFields,
                submitPromptTemplate: s.submitPromptTemplate,
              })),
            );
          }
        })
        .catch(() => {
          /* mantém fallback */
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    if (loading && items.length === 0) {
      return (
        <div className="starter-cards-wrapper">
          <p className="starter-cards-subtitle">Carregando opções…</p>
        </div>
      );
    }

    return (
      <StarterCards items={items} title={opts?.title} subtitle={opts?.subtitle} />
    );
  };
}
