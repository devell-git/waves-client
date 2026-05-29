"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// StepsItem — etapa individual de um Steps wizard

const StepsItemSchema = z.object({
  title: z.string(),
  details: z.string().optional(),
  // Status visual da etapa
  status: z
    .enum(["pending", "in_progress", "completed", "blocked"])
    .optional(),
});

export const StepsItem = defineComponent({
  name: "StepsItem",
  props: StepsItemSchema,
  description:
    "Etapa de uma sequência Steps. title: nome da etapa (string). " +
    "details (opcional): descrição secundária. " +
    "status (opcional): 'pending' | 'in_progress' | 'completed' | 'blocked' — " +
    "define cor e estilo visual do indicador.",
  component: () => null,
});

// ─────────────────────────────────────────────────────────────────
// Steps — sequência vertical numerada de etapas

const StepsSchema = z.object({
  items: z.array(StepsItem.ref),
  // Etapa atualmente ativa (1-indexed); se omitido, usa status de cada item
  currentStep: z.number().int().min(1).optional(),
  title: z.string().optional(),
});

export const Steps = defineComponent({
  name: "Steps",
  props: StepsSchema,
  description:
    "Sequência vertical de etapas estilo wizard/progress. items: array de StepsItem. " +
    "currentStep (opcional, 1-indexed): destaca o passo atual. " +
    "title (opcional). Use para onboarding, roteiro de tarefas, plano de execução em " +
    "ordem. Para lista sem ordem use List; para grade ou kanban use Kanban.",
  component: ({ props }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems = (props.items ?? []) as any[];
    const items = rawItems
      .filter((it) => it?.props?.title != null)
      .map((it) => ({
        title: String(it.props.title),
        details: it.props.details ? String(it.props.details) : undefined,
        status: it.props.status as
          | "pending"
          | "in_progress"
          | "completed"
          | "blocked"
          | undefined,
      }));
    const currentStep = props.currentStep as number | undefined;
    const title = props.title as string | undefined;

    return (
      <div className="space-y-2">
        {title && <div className="text-sm font-semibold">{title}</div>}
        <ol className="space-y-3">
          {items.map((item, i) => {
            const stepNumber = i + 1;
            let effectiveStatus = item.status;
            // Se currentStep dado, deriva status de cada item
            if (!effectiveStatus && typeof currentStep === "number") {
              if (stepNumber < currentStep) effectiveStatus = "completed";
              else if (stepNumber === currentStep) effectiveStatus = "in_progress";
              else effectiveStatus = "pending";
            }

            const indicatorClass = (() => {
              switch (effectiveStatus) {
                case "completed":
                  return "bg-green-600 text-white border-green-600";
                case "in_progress":
                  return "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900";
                case "blocked":
                  return "bg-red-600 text-white border-red-600";
                case "pending":
                default:
                  return "bg-background text-muted-foreground border-border";
              }
            })();

            const connectorClass = (() => {
              if (effectiveStatus === "completed") return "bg-green-600";
              if (effectiveStatus === "in_progress") return "bg-gradient-to-b from-blue-600 to-border";
              return "bg-border";
            })();

            const isLast = i === items.length - 1;

            return (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold shrink-0 ${indicatorClass}`}
                  >
                    {effectiveStatus === "completed" ? "✓" : stepNumber}
                  </div>
                  {!isLast && <div className={`w-px flex-1 mt-1 ${connectorClass}`} />}
                </div>
                <div className="flex-1 pb-3">
                  <div
                    className={`text-sm font-medium ${
                      effectiveStatus === "completed"
                        ? "text-muted-foreground line-through"
                        : ""
                    }`}
                  >
                    {item.title}
                  </div>
                  {item.details && (
                    <div className="text-xs text-muted-foreground mt-0.5">{item.details}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  },
});
