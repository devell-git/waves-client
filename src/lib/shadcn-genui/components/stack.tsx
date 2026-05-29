"use client";

import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

import { cn } from "@/lib/utils";

import { ChatContentChildUnion } from "../unions";

/**
 * Stack — container de layout flexível (kanban, dashboards multi-coluna).
 *
 * Aceita qualquer componente do ChatContentChildUnion como children. `Card`
 * em si vive em `index.tsx` (ChatCard) — pra usar `Card` dentro de `Stack` o
 * próprio union já cobre indiretamente (a referência self-recursive de
 * Stack→Stack é validada pelo runtime).
 *
 * Argumentos posicionais (compat com openuiChatLibrary built-in):
 *   Stack(children, direction?, gap?, alignX?, alignY?)
 */

const GAP_CLASS: Record<string, string> = {
  none: "gap-0",
  xs: "gap-1",
  s: "gap-2",
  m: "gap-4",
  l: "gap-6",
  xl: "gap-8",
};

const ALIGN_X: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  stretch: "justify-stretch",
  between: "justify-between",
};

const ALIGN_Y: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export const Stack = defineComponent({
  name: "Stack",
  description:
    "Flexible layout container. Use for multi-column layouts (kanban, dashboards, side-by-side cards) " +
    "or any non-vertical arrangement. Args: children, direction (column|row, default column), " +
    "gap (none|xs|s|m|l|xl, default m), alignX (justify), alignY (items). " +
    "Use Card or another Stack as children to build nested layouts.",
  props: z.object({
    // Aceita conteúdo geral; Card e Stack aninhado são validados em runtime
    // pelo parser (z.lazy/recursive resolve no merge da library).
    children: z.array(ChatContentChildUnion as z.ZodTypeAny),
    direction: z
      .enum(["column", "row"])
      .optional()
      .describe("Layout direction (default: column)"),
    gap: z
      .enum(["none", "xs", "s", "m", "l", "xl"])
      .optional()
      .describe("Gap between children (default: m)"),
    alignX: z
      .enum(["start", "center", "end", "stretch", "between"])
      .optional()
      .describe("Align along main axis (default: start)"),
    alignY: z
      .enum(["start", "center", "end", "stretch"])
      .optional()
      .describe("Align along cross axis (default: stretch)"),
  }),
  component: ({ props, renderNode }) => {
    const direction = props.direction ?? "column";
    const gap = props.gap ?? "m";
    const alignX = props.alignX;
    const alignY = props.alignY;

    return (
      <div
        className={cn(
          "flex",
          direction === "row" ? "flex-row" : "flex-col",
          GAP_CLASS[gap],
          alignX ? ALIGN_X[alignX] : "",
          alignY ? ALIGN_Y[alignY] : "",
          direction === "row" ? "flex-wrap" : "",
        )}
      >
        {renderNode(props.children)}
      </div>
    );
  },
});
