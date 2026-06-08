"use client";

import {
  SelectContent,
  SelectTrigger,
  SelectValue,
  Select as ShadcnSelect,
  SelectItem as ShadcnSelectItem,
} from "@/components/ui/select";
import {
  defineComponent,
  useFormName,
  useGetFieldValue,
  useIsStreaming,
  useSetFieldValue,
} from "@openuidev/react-lang";
import React from "react";
import { z } from "zod";

// ── Convenção dos nomes de campo da BNCC (decisão do produto) ──
// O nível (Infantil x Fundamental) define a hierarquia E os nomes dos 3 campos
// que o componente preenche no formState. São EXATAMENTE estes — o agente emite
// só `BnccSelect("infantil"|"fundamental")` e a cascata escreve nestes nomes.
const FIELD_NAMES = {
  infantil: ["faixa-idade", "campo-experiencia", "objetivo-aprendizagem"],
  fundamental: ["componente-curricular", "ano-faixa", "habilidade"],
} as const;

const LABELS = {
  infantil: ["Faixa etária", "Campo de experiência", "Objetivo de aprendizagem"],
  fundamental: ["Componente curricular", "Ano/Faixa", "Habilidade"],
} as const;

type Level = keyof typeof FIELD_NAMES;
type Node = { value: string; label: string; children: Node[] };

// Tira tags HTML e espaços sobrando (descr do Fundamental vem com <b>...</b>).
function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ── Normaliza os 2 JSONs da BNCC numa árvore uniforme de 3 níveis ──
function normalizeInfantil(data: any[]): Node[] {
  return (data ?? []).map((faixa) => ({
    value: faixa.label,
    label: faixa.label,
    children: (faixa.experienceFields ?? []).map((ef: any) => ({
      value: ef.code,
      label: ef.label,
      children: (ef.skills ?? []).map((sk: any) => ({
        value: sk.code,
        label: `${sk.code} — ${sk.label}`,
        children: [],
      })),
    })),
  }));
}

function normalizeFundamental(data: any[]): Node[] {
  return (data ?? []).map((area) => ({
    value: area.label,
    label: area.label,
    children: (area.years ?? []).map((year: any) => ({
      value: year.label,
      label: year.label,
      children: (year.skills ?? []).map((sk: any) => {
        const raw = String(sk.descr ?? "");
        const codeMatch = raw.match(/<b>\s*([^<]+?)\s*<\/b>/i);
        const code = codeMatch ? codeMatch[1].trim() : stripHtml(raw).slice(0, 12);
        return { value: code, label: stripHtml(raw), children: [] };
      }),
    })),
  }));
}

const BnccSelectSchema = z.object({
  // "infantil" → faixa-idade → campo-experiencia → objetivo-aprendizagem
  // "fundamental" → componente-curricular → ano-faixa → habilidade
  level: z.enum(["infantil", "fundamental"]),
  // Pré-preenchimento: { "<nome-do-campo>": "<valor>" } com os 3 valores da última
  // vez. A cascata é reconstruída a partir deles.
  value: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const BnccSelect = defineComponent({
  name: "BnccSelect",
  props: BnccSelectSchema,
  description:
    "Cascata de selects dependentes da BNCC. level='infantil' (faixa-idade→campo-experiencia→" +
    "objetivo-aprendizagem) ou 'fundamental' (componente-curricular→ano-faixa→habilidade). " +
    "Escreve os 3 valores no formState sob esses nomes. Use DENTRO de um Form, no lugar de Selects manuais.",
  component: ({ props }) => {
    const level = props.level as Level;
    const names = FIELD_NAMES[level];
    const labels = LABELS[level];

    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    const setFieldValue = useSetFieldValue();
    const isStreaming = useIsStreaming();

    const [tree, setTree] = React.useState<Node[] | null>(null);
    // valores selecionados por nível (0,1,2)
    const [sel, setSel] = React.useState<[string, string, string]>(["", "", ""]);

    // Carrega o JSON da BNCC sob demanda — o de Fundamental tem ~1 MB, então só
    // baixa quando este componente monta (code-split via import dinâmico).
    React.useEffect(() => {
      let alive = true;
      (async () => {
        const mod =
          level === "infantil"
            ? await import("../../bncc/bncc-infantil.json")
            : await import("../../bncc/bncc-fundamental.json");
        const data = (mod as any).default ?? mod;
        if (!alive) return;
        setTree(level === "infantil" ? normalizeInfantil(data) : normalizeFundamental(data));
      })();
      return () => {
        alive = false;
      };
    }, [level]);

    // Semeia a seleção a partir de props.value OU do que já está no formState
    // (pré-preenchimento da última vez). Roda uma vez, quando a árvore chega.
    React.useEffect(() => {
      if (!tree) return;
      const seed: [string, string, string] = ["", "", ""];
      for (let i = 0; i < 3; i++) {
        const fromProps = props.value ? props.value[names[i]] : undefined;
        const fromForm = formName ? getFieldValue(formName, names[i]) : undefined;
        const v = fromProps ?? fromForm;
        if (v != null && v !== "") {
          seed[i] = String(v);
          if (formName) setFieldValue(formName, "BnccSelect", names[i], String(v), false);
        }
      }
      setSel(seed);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tree]);

    // Opções de cada nível dependem da seleção do nível anterior.
    const level1 = tree ?? [];
    const node1 = level1.find((n) => n.value === sel[0]);
    const level2 = node1?.children ?? [];
    const node2 = level2.find((n) => n.value === sel[1]);
    const level3 = node2?.children ?? [];

    const options = [level1, level2, level3];

    const onPick = (idx: number, val: string) => {
      setSel((prev) => {
        const next: [string, string, string] = [...prev] as any;
        next[idx] = val;
        // limpa os níveis abaixo (a cascata mudou)
        for (let j = idx + 1; j < 3; j++) next[j] = "";
        return next;
      });
      if (formName) {
        setFieldValue(formName, "BnccSelect", names[idx], val, true);
        for (let j = idx + 1; j < 3; j++) setFieldValue(formName, "BnccSelect", names[j], "", true);
      }
    };

    return (
      <div className="space-y-3">
        {[0, 1, 2].map((idx) => {
          const opts = options[idx];
          const disabled = isStreaming || (idx > 0 && !sel[idx - 1]) || opts.length === 0;
          return (
            <div key={names[idx]} className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">{labels[idx]}</label>
              <ShadcnSelect
                value={sel[idx] || ""}
                onValueChange={(v) => onPick(idx, v)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder={disabled && idx > 0 ? "Selecione o anterior…" : "Selecione…"} />
                </SelectTrigger>
                <SelectContent>
                  {opts.map((o, i) => (
                    <ShadcnSelectItem key={`${o.value}-${i}`} value={o.value}>
                      {o.label}
                    </ShadcnSelectItem>
                  ))}
                </SelectContent>
              </ShadcnSelect>
            </div>
          );
        })}
      </div>
    );
  },
});
