"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Check, ChevronDown, Circle, Square, X } from "lucide-react";
import * as React from "react";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// ListItem — item individual de uma List

const ListItemSchema = z.object({
  text: z.string(),
  // Conteúdo opcional que aparece embaixo do item quando expandido
  expandable: z.array(z.any()).optional(),
  // Status com ícone à esquerda
  status: z.enum(["done", "todo", "blocked", "in_progress", "info"]).optional(),
  // Subtítulo (texto cinza menor abaixo do principal)
  subtitle: z.string().optional(),
});

export const ListItem = defineComponent({
  name: "ListItem",
  props: ListItemSchema,
  description:
    "Item de uma List. text: conteúdo principal (string). " +
    "subtitle (opcional): texto secundário em cinza. " +
    "status (opcional): 'done' | 'todo' | 'blocked' | 'in_progress' | 'info' — ícone à esquerda. " +
    "expandable (opcional): array de componentes que aparece ao clicar (útil pra checklist com notas).",
  component: ({ props, renderNode }) => {
    const expandable = (props.expandable ?? []) as unknown[];
    const hasExpandable = expandable.length > 0;
    const [open, setOpen] = React.useState(false);
    const status = props.status as string | undefined;
    const subtitle = props.subtitle as string | undefined;

    const renderStatus = () => {
      switch (status) {
        case "done":
          return <Check className="h-4 w-4 text-green-600" />;
        case "blocked":
          return <X className="h-4 w-4 text-red-600" />;
        case "in_progress":
          return <Circle className="h-4 w-4 text-blue-600 fill-current" />;
        case "info":
          return <Circle className="h-3 w-3 text-blue-500" />;
        case "todo":
          return <Square className="h-4 w-4 text-muted-foreground" />;
        default:
          return null;
      }
    };

    return (
      <li
        className={`group ${hasExpandable ? "cursor-pointer" : ""}`}
        onClick={hasExpandable ? () => setOpen((v) => !v) : undefined}
      >
        <div className="flex items-start gap-2 py-1">
          {status && <div className="mt-0.5 shrink-0">{renderStatus()}</div>}
          <div className="flex-1 min-w-0">
            <div className="text-sm leading-snug">{String(props.text)}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
            )}
          </div>
          {hasExpandable && (
            <ChevronDown
              className={`h-3 w-3 shrink-0 text-muted-foreground mt-1 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          )}
        </div>
        {hasExpandable && open && (
          <div
            className="ml-6 mt-1 mb-2 pl-3 border-l-2 border-border space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {renderNode(expandable)}
          </div>
        )}
      </li>
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// List — container vertical de ListItems

const ListSchema = z.object({
  items: z.array(ListItem.ref),
  // Tipo de marcador (default "bullet")
  marker: z
    .enum(["bullet", "number", "none", "check", "square"])
    .optional(),
  // Título opcional acima da lista
  title: z.string().optional(),
});

export const List = defineComponent({
  name: "List",
  props: ListSchema,
  description:
    "Lista vertical com marcadores. items: array de ListItem. " +
    "marker (opcional, default 'bullet'): 'bullet' | 'number' | 'none' | 'check' | 'square'. " +
    "title (opcional): cabeçalho acima da lista. " +
    "Use para starters, checklists, listas de riscos/decisões. " +
    "Para listas tabulares use Table; para itens colapsáveis em categorias use Accordion.",
  component: ({ props, renderNode }) => {
    const items = (props.items ?? []) as unknown[];
    const marker = (props.marker as string | undefined) ?? "bullet";
    const title = props.title as string | undefined;

    let listClass = "space-y-1 pl-5";
    let tag: "ol" | "ul" = "ul";
    if (marker === "number") {
      tag = "ol";
      listClass = "list-decimal space-y-1 pl-6";
    } else if (marker === "bullet") {
      listClass = "list-disc space-y-1 pl-5";
    } else if (marker === "square") {
      listClass = "list-[square] space-y-1 pl-5";
    } else if (marker === "check" || marker === "none") {
      listClass = "list-none space-y-1 pl-0";
    }

    return (
      <div className="space-y-2">
        {title && <div className="text-sm font-semibold">{title}</div>}
        {tag === "ol" ? (
          <ol className={listClass}>{renderNode(items)}</ol>
        ) : (
          <ul className={listClass}>{renderNode(items)}</ul>
        )}
      </div>
    );
  },
});
