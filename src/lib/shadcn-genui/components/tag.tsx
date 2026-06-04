"use client";

import { Badge } from "@/components/ui/badge";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";

// Tolerante a drift do agente: aceita `text` OU `label` (a SOUL ensina `label`),
// e QUALQUER variant (semânticos info/success/warning vêm dos agentes) — mapeando
// pro vocabulário do Badge em vez de rejeitar a árvore inteira na validação.
const TagSchema = z.object({
  text: z.string().optional(),
  label: z.string().optional(),
  variant: z.string().optional(),
  color: z.string().optional(), // ignorado; agentes às vezes mandam
});

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
const BADGE_VARIANTS = new Set<BadgeVariant>(["default", "secondary", "destructive", "outline"]);
export function mapBadgeVariant(v?: string): BadgeVariant {
  if (v && BADGE_VARIANTS.has(v as BadgeVariant)) return v as BadgeVariant;
  if (v === "error" || v === "danger" || v === "warning") return "destructive";
  return "secondary"; // default/info/success/ghost/desconhecidos
}
export const tagText = (p: { text?: string; label?: string } | undefined): string =>
  String(p?.text ?? p?.label ?? "");

export const Tag = defineComponent({
  name: "Tag",
  props: TagSchema,
  description: "Styled tag/badge. Used inside TagBlock. Aceita text|label e qualquer variant.",
  component: ({ props }) => <Badge variant={mapBadgeVariant(props.variant)}>{tagText(props)}</Badge>,
});

export const TagBlock = defineComponent({
  name: "TagBlock",
  props: z.object({
    tags: z.array(z.union([z.string(), Tag.ref])),
  }),
  description: "Group of tags. Accepts string array or Tag references.",
  component: ({ props }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = (props.tags ?? []) as any[];
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => {
          if (typeof tag === "string") {
            return (
              <Badge key={i} variant="secondary">
                {tag}
              </Badge>
            );
          }
          return (
            <Badge key={i} variant={mapBadgeVariant(tag?.props?.variant)}>
              {tagText(tag?.props)}
            </Badge>
          );
        })}
      </div>
    );
  },
});
