"use client";

import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { defineComponent } from "@openuidev/react-lang";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { z } from "zod";

// NOTA: Table está em ContentChildUnion (unions.ts), então NÃO podemos importar
// `ContentChildUnion` aqui (ciclo de import). Em `expandableRows` usamos
// z.array(z.any()) — type safety é menor mas runtime funciona porque o
// `renderNode` aceita qualquer ref de componente registrado.

const ColSchema = z.object({
  header: z.string(),
  type: z.enum(["string", "number", "boolean"]).optional(),
});

export const Col = defineComponent({
  name: "Col",
  props: ColSchema,
  description: "Column definition for Table — header label and optional type.",
  component: () => null,
});

const TableSchema = z.object({
  columns: z.array(Col.ref),
  rows: z.array(z.array(z.any())),
  // Linhas expansíveis: array com mesmo tamanho de `rows`. Cada entrada é o
  // conteúdo (lista de componentes) que aparece embaixo da linha quando o
  // usuário clica no chevron. Use null/array vazia em entradas sem expansão.
  expandableRows: z.array(z.array(z.any())).optional(),
});

export const Table = defineComponent({
  name: "Table",
  props: TableSchema,
  description:
    "Data table. columns: Col[] with header/type, rows: 2D array of values. " +
    "expandableRows (opcional): array paralelo a `rows` — entrada i contém componentes " +
    "que aparecem em painel embaixo da linha i quando o user clica no chevron. " +
    "Use índice vazio (array vazia) pra linhas que não expandem.",
  component: ({ props, renderNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const columns = ((props.columns ?? []) as any[]).map((c) => ({
      header: String(c?.props?.header ?? ""),
      type: c?.props?.type ?? "string",
    }));
    const rows = (props.rows ?? []) as unknown[][];
    const expandableRows = (props.expandableRows ?? []) as unknown[][];
    const hasExpansion = expandableRows.some((c) => Array.isArray(c) && c.length > 0);

    const [openSet, setOpenSet] = React.useState<Set<number>>(new Set());
    const toggle = (i: number) =>
      setOpenSet((s) => {
        const next = new Set(s);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });

    const totalCols = columns.length + (hasExpansion ? 1 : 0);

    return (
      <div className="rounded-md border">
        <ShadcnTable>
          <TableHeader>
            <TableRow>
              {hasExpansion && <TableHead className="w-8 px-2"></TableHead>}
              {columns.map((col, i) => (
                <TableHead key={i} className={col.type === "number" ? "text-right" : ""}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, ri) => {
              const expansion = expandableRows[ri] as unknown[] | undefined;
              const isExpandable = Array.isArray(expansion) && expansion.length > 0;
              const isOpen = openSet.has(ri);
              return (
                <React.Fragment key={ri}>
                  <TableRow
                    className={isExpandable ? "cursor-pointer" : ""}
                    onClick={isExpandable ? () => toggle(ri) : undefined}
                  >
                    {hasExpansion && (
                      <TableCell className="w-8 px-2 text-muted-foreground">
                        {isExpandable && (
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        )}
                      </TableCell>
                    )}
                    {columns.map((col, ci) => (
                      <TableCell
                        key={ci}
                        className={col.type === "number" ? "text-right tabular-nums" : ""}
                      >
                        {String(row[ci] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isExpandable && isOpen && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={totalCols} className="p-3">
                        <div className="space-y-2">{renderNode(expansion as unknown[])}</div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </ShadcnTable>
      </div>
    );
  },
});
