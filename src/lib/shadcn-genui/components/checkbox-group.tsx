"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label as ShadcnLabel } from "@/components/ui/label";
import {
  defineComponent,
  useFormName,
  useGetFieldValue,
  useIsStreaming,
  useSetFieldValue,
} from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";

const CheckBoxItemSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const CheckBoxItem = defineComponent({
  name: "CheckBoxItem",
  props: CheckBoxItemSchema,
  description: "Option in a CheckBoxGroup.",
  component: () => null,
});

const CheckBoxGroupSchema = z.object({
  name: z.string(),
  items: z.array(CheckBoxItem.ref),
  // Valores inicialmente marcados (ids) — usado no form de EDIÇÃO pra já vir com
  // os visualizadores atuais checados. Aceita números ou strings.
  value: z.array(z.union([z.string(), z.number()])).optional(),
});

export const CheckBoxGroup = defineComponent({
  name: "CheckBoxGroup",
  props: CheckBoxGroupSchema,
  description: "Multiple checkbox options. items: CheckBoxItem[].",
  component: ({ props }) => {
    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    const setFieldValue = useSetFieldValue();
    const isStreaming = useIsStreaming();

    const fieldName = props.name as string;
    const current = (getFieldValue(formName, fieldName) as string[] | undefined) ?? [];

    // Semeia os marcados iniciais (props.value) no estado do form, se vazio.
    React.useEffect(() => {
      const init = props.value as Array<string | number> | undefined;
      if (!init || init.length === 0) return;
      const cur = getFieldValue(formName, fieldName) as string[] | undefined;
      if (!cur || cur.length === 0) {
        setFieldValue(formName, "CheckBoxGroup", fieldName, init.map(String), false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((props.items ?? []) as any[]).filter((item) => item?.props?.value);

    return (
      <div className="space-y-2">
        {items.map((item, i) => {
          const val = item.props.value as string;
          const checked = current.includes(val);
          return (
            <div key={i} className="flex items-center space-x-2">
              <Checkbox
                id={`${fieldName}-${val}`}
                checked={checked}
                onCheckedChange={(c) => {
                  const next = c ? [...current, val] : current.filter((v: string) => v !== val);
                  setFieldValue(formName, "CheckBoxGroup", fieldName, next, true);
                }}
                disabled={isStreaming}
              />
              <ShadcnLabel htmlFor={`${fieldName}-${val}`}>{item.props.label || val}</ShadcnLabel>
            </div>
          );
        })}
      </div>
    );
  },
});
