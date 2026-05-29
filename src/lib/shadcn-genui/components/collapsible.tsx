"use client";

import { defineComponent } from "@openuidev/react-lang";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { z } from "zod";

// `content` é tipado como z.any() para evitar ciclo de import com unions.ts
// (Collapsible é referenciado no ChatCardChildUnion do index, que monta o
// union de root-card). Runtime: renderNode aceita ref de qualquer componente.

const CollapsibleSchema = z.object({
  title: z.string(),
  content: z.array(z.any()),
  defaultOpen: z.boolean().optional(),
});

export const Collapsible = defineComponent({
  name: "Collapsible",
  props: CollapsibleSchema,
  description:
    "Bloco único colapsável (não confundir com Accordion que é lista de itens). " +
    "title: header sempre visível. content: corpo dobrável (array de componentes). " +
    "defaultOpen (opcional, default false): se inicia aberto. Use para 'Ler mais', " +
    "'Detalhes', 'Notas avançadas', 'Configurações opcionais' onde não precisa de várias " +
    "seções listadas. Para listas de seções use Accordion.",
  component: ({ props, renderNode }) => {
    const [open, setOpen] = React.useState(Boolean(props.defaultOpen));
    const title = String(props.title ?? "");
    const content = (props.content ?? []) as unknown[];

    return (
      <div className="rounded-md border bg-card overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{title}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && content.length > 0 && (
          <div className="border-t p-3 space-y-2">{renderNode(content)}</div>
        )}
      </div>
    );
  },
});
