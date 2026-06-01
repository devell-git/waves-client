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
  parseStructuredRules,
  useFormName,
  useFormValidation,
  useGetFieldValue,
  useIsStreaming,
  useSetFieldValue,
} from "@openuidev/react-lang";
import React from "react";
import { z } from "zod";
import { rulesSchema } from "../rules";

const SelectItemSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const SelectItem = defineComponent({
  name: "SelectItem",
  props: SelectItemSchema,
  description: "Option for Select dropdown.",
  component: () => null,
});

const SelectSchema = z.object({
  name: z.string(),
  items: z.array(SelectItem.ref),
  placeholder: z.string().optional(),
  rules: rulesSchema,
  // Valor inicial (id da opção pré-selecionada) — usado no form de EDIÇÃO pra
  // já vir com o valor atual da task. Aceita número ou string.
  value: z.union([z.string(), z.number()]).optional(),
});

export const Select = defineComponent({
  name: "Select",
  props: SelectSchema,
  description: "Dropdown select. items: SelectItem[], placeholder, rules for validation.",
  component: ({ props }) => {
    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    const setFieldValue = useSetFieldValue();
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();

    const fieldName = props.name as string;
    const rules = React.useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    const value = getFieldValue(formName, fieldName) as string | undefined;

    // Semeia o valor inicial (props.value) no estado do form, se ainda vazio.
    React.useEffect(() => {
      if (props.value == null) return;
      const cur = getFieldValue(formName, fieldName);
      if (cur == null || cur === "") {
        setFieldValue(formName, "Select", fieldName, String(props.value), false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
      if (!isStreaming && rules.length > 0 && formValidation) {
        formValidation.registerField(fieldName, rules, () => getFieldValue(formName, fieldName));
        return () => formValidation.unregisterField(fieldName);
      }
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStreaming, rules.length > 0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((props.items ?? []) as any[]).filter((item) => item?.props?.value);

    return (
      <ShadcnSelect
        value={value ?? ""}
        onValueChange={(val) => {
          setFieldValue(formName, "Select", fieldName, val, true);
          if (rules.length > 0 && formValidation)
            formValidation.validateField(fieldName, val, rules);
        }}
        disabled={isStreaming}
      >
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder ?? "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item, i) => (
            <ShadcnSelectItem key={i} value={item.props.value}>
              {item.props.label || item.props.value}
            </ShadcnSelectItem>
          ))}
        </SelectContent>
      </ShadcnSelect>
    );
  },
});
