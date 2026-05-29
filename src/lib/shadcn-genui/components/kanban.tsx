"use client";

import { defineComponent } from "@openuidev/react-lang";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { Avatar } from "./avatar";
import { Progress } from "./progress";
import { ShadcnBadgeComponent } from "./badge";

// ─────────────────────────────────────────────────────────────────
// KanbanCard — uma task individual num column

const KanbanCardSchema = z.object({
  title: z.string(),
  badges: z.array(z.string()).optional(),
  progress: z.number().min(0).max(100).optional(),
  responsibleName: z.string().optional(),
  responsibleAvatar: z.string().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  id: z.string().optional(),
  // Conteúdo opcional que aparece embaixo do card quando expandido (click no card).
  // Usa z.any() pra evitar ciclo com unions.ts.
  expandable: z.array(z.any()).optional(),
});

export const KanbanCard = defineComponent({
  name: "KanbanCard",
  props: KanbanCardSchema,
  description:
    "Card de uma task individual no Kanban. title obrigatório, demais opcionais. " +
    "badges: pequenos rótulos no topo (ex.: ['15d 6h']). progress: 0-100. " +
    "responsibleName/Avatar: pessoa responsável. tags: rótulos coloridos. " +
    "expandable (opcional): array de componentes que aparece embaixo do card " +
    "quando o user clica nele — use pra mostrar descrição completa, checklist, " +
    "comentários, dependências sob demanda.",
  component: ({ props, renderNode }) => {
    const badges = (props.badges ?? []) as string[];
    const tags = (props.tags ?? []) as string[];
    const progress = props.progress as number | undefined;
    const responsibleName = props.responsibleName as string | undefined;
    const responsibleAvatar = props.responsibleAvatar as string | undefined;
    const expandable = (props.expandable ?? []) as unknown[];
    const hasExpandable = expandable.length > 0;
    const [open, setOpen] = React.useState(false);

    return (
      <div
        className={`rounded-md border bg-card p-2.5 shadow-sm space-y-2 transition-colors ${
          hasExpandable ? "cursor-pointer hover:bg-accent/50" : ""
        }`}
        onClick={hasExpandable ? () => setOpen((v) => !v) : undefined}
      >
        {(badges.length > 0 || hasExpandable) && (
          <div className="flex items-start justify-between gap-1">
            <div className="flex flex-wrap gap-1 flex-1">
              {badges.map((b, i) => (
                <span
                  key={i}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {b}
                </span>
              ))}
            </div>
            {hasExpandable && (
              <ChevronDown
                className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform mt-1 ${
                  open ? "rotate-180" : ""
                }`}
              />
            )}
          </div>
        )}
        <div className="text-sm font-medium leading-snug">{String(props.title)}</div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded-full border bg-background"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {typeof progress === "number" && (
          <div className="space-y-0.5">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground text-right">{Math.round(progress)}%</div>
          </div>
        )}
        {responsibleName && (
          <div className="flex items-center gap-1.5 pt-1 border-t">
            {responsibleAvatar ? (
              <img
                src={responsibleAvatar}
                alt={responsibleName}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">
                {responsibleName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-xs text-muted-foreground truncate">{responsibleName}</span>
          </div>
        )}
        {hasExpandable && open && (
          <div
            className="border-t pt-2 mt-2 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {renderNode(expandable)}
          </div>
        )}
      </div>
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// KanbanColumn — uma coluna (stage) com header + cards

const KanbanColumnSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  count: z.number().optional(),
  cards: z.array(KanbanCard.ref),
});

export const KanbanColumn = defineComponent({
  name: "KanbanColumn",
  props: KanbanColumnSchema,
  description:
    "Coluna do Kanban (um stage). name: nome da coluna; color: hex (#dc3545) para borda " +
    "superior; count: número de tasks; cards: array de KanbanCard.",
  component: ({ props, renderNode }) => {
    const cards = (props.cards ?? []) as unknown[];
    const color = props.color as string | undefined;
    const count = props.count as number | undefined;

    return (
      <div className="flex flex-col min-w-[260px] max-w-[300px] bg-muted/40 rounded-lg overflow-hidden flex-shrink-0">
        <div
          className="px-3 py-2 border-b bg-background/60 backdrop-blur"
          style={color ? { borderTop: `3px solid ${color}` } : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold truncate">{String(props.name)}</span>
            {typeof count === "number" && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {count}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[600px]">
          {cards.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">Sem tasks</div>
          ) : (
            renderNode(cards)
          )}
        </div>
      </div>
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// Kanban — container root horizontal com scroll

const KanbanSchema = z.object({
  columns: z.array(KanbanColumn.ref),
  title: z.string().optional(),
});

export const Kanban = defineComponent({
  name: "Kanban",
  props: KanbanSchema,
  description:
    "Board Kanban (estilo Trello/Jira). columns: array de KanbanColumn em layout horizontal " +
    "com scroll. title: cabeçalho opcional acima do board. Use para visualizar tasks " +
    "agrupadas por stage/status. NÃO use Stack(horizontal) pra simular kanban — use este " +
    "componente que tem scroll horizontal nativo, alturas iguais e visual de board.",
  component: ({ props, renderNode }) => {
    const columns = (props.columns ?? []) as unknown[];
    const title = props.title as string | undefined;

    return (
      <div className="space-y-2">
        {title && <div className="text-sm font-semibold px-1">{title}</div>}
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {columns.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4">Kanban vazio.</div>
          ) : (
            renderNode(columns)
          )}
        </div>
      </div>
    );
  },
});

// Re-exports pra evitar "unused" warning no helpers se forem usados
void Avatar;
void Progress;
void ShadcnBadgeComponent;
