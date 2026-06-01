"use client";

import {
  FormNameContext,
  FormValidationContext,
  defineComponent,
  useCreateFormValidation,
} from "@openuidev/react-lang";
import * as React from "react";
import { z } from "zod";
import { Buttons } from "./buttons";
import { FormControl } from "./form-control";

const FormSchema = z.object({
  name: z.string(),
  buttons: Buttons.ref,
  fields: z.array(FormControl.ref).default([]),
});

export const Form = defineComponent({
  name: "Form",
  props: FormSchema,
  description:
    "Form container with fields and explicit action buttons. fields: FormControl[], buttons: Buttons. " +
    "Um botão 'Cancelar' é adicionado AUTOMATICAMENTE (dispensa o form) — NÃO inclua um botão próprio de cancelar/voltar.",
  component: ({ props, renderNode }) => {
    const formValidation = useCreateFormValidation();
    const formName = props.name as string;
    const [dismissed, setDismissed] = React.useState(false);

    if (dismissed) {
      return (
        <div className="text-sm text-muted-foreground italic py-1">
          Formulário cancelado.
        </div>
      );
    }

    return (
      <FormValidationContext.Provider value={formValidation}>
        <FormNameContext.Provider value={formName}>
          <div role="form" className="space-y-4">
            {renderNode(props.fields)}
            {/* Botões do agente (criar/salvar/etc.) + Cancelar automático */}
            <div className="flex items-center gap-2 flex-wrap">
              {renderNode(props.buttons)}
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Cancelar
              </button>
            </div>
          </div>
        </FormNameContext.Provider>
      </FormValidationContext.Provider>
    );
  },
});
