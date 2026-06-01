"use client";

import { Button as ShadcnButton } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  defineComponent,
  useFormName,
  useGetFieldValue,
  useIsStreaming,
  useSetFieldValue,
} from "@openuidev/react-lang";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import * as React from "react";
import { z } from "zod";

const DatePickerSchema = z.object({
  name: z.string(),
  placeholder: z.string().optional(),
  // Data inicial (ISO ou YYYY-MM-DD) — usado no form de EDIÇÃO (prazo atual).
  value: z.string().optional(),
});

export const DatePicker = defineComponent({
  name: "DatePicker",
  props: DatePickerSchema,
  description: "Date selection input with calendar popover.",
  component: ({ props }) => {
    const formName = useFormName();
    const getFieldValue = useGetFieldValue();
    const setFieldValue = useSetFieldValue();
    const isStreaming = useIsStreaming();

    const fieldName = props.name as string;
    const saved = getFieldValue(formName, fieldName) as string | undefined;

    // Semeia o prazo inicial (props.value) no estado do form, se vazio.
    React.useEffect(() => {
      if (!props.value) return;
      const cur = getFieldValue(formName, fieldName);
      if (cur == null || cur === "") {
        const d = new Date(props.value as string);
        if (!Number.isNaN(d.getTime())) {
          setFieldValue(formName, "DatePicker", fieldName, d.toISOString(), false);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const date = saved ? new Date(saved) : undefined;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <ShadcnButton
            variant="outline"
            className={`w-full justify-start text-left font-normal ${!date ? "text-muted-foreground" : ""}`}
            disabled={isStreaming}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "PPP") : (props.placeholder ?? "Pick a date")}
          </ShadcnButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              if (d) {
                setFieldValue(formName, "DatePicker", fieldName, d.toISOString(), true);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    );
  },
});
