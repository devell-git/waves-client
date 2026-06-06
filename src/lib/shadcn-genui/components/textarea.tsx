"use client";

import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
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

const TextareaSchema = z.object({
  name: z.string(),
  placeholder: z.string().optional(),
  rows: z.number().optional(),
  rules: rulesSchema,
  // Valor inicial — pré-preenche o campo (ex.: checklist/descrição vindos de um
  // comando em linguagem natural). Multi-linha. Igual ao `value` do Input/Select.
  value: z.string().optional(),
});

export const TextArea = defineComponent({
  name: "TextArea",
  props: TextareaSchema,
  description:
    "Multi-line text input. rows sets visible height. rules for validation. " +
    "value pre-fills the field (multi-line), e.g. a checklist parsed from a command.",
  component: ({ props }) => {
    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    const setFieldValue = useSetFieldValue();
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();

    const fieldName = props.name as string;
    const rules = React.useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    const savedValue = getFieldValue(formName, fieldName) ?? "";
    // Valor inicial: o do form (se já mexeu) ou o props.value (pré-preenchido).
    const initialValue =
      (savedValue as string) || (props.value != null ? String(props.value) : "");

    // Semeia props.value no estado do form, se vazio (pra submeter mesmo intocado).
    React.useEffect(() => {
      if (props.value == null) return;
      const cur = getFieldValue(formName, fieldName);
      if (cur == null || cur === "") {
        setFieldValue(formName, "TextArea", fieldName, String(props.value), false);
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

    return (
      <ShadcnTextarea
        name={fieldName}
        placeholder={props.placeholder}
        rows={props.rows ?? 3}
        defaultValue={initialValue}
        onBlur={(e) => {
          const val = e.target.value;
          if (val !== savedValue) setFieldValue(formName, "TextArea", fieldName, val, true);
          if (rules.length > 0 && formValidation)
            formValidation.validateField(fieldName, val, rules);
        }}
        disabled={isStreaming}
      />
    );
  },
});
