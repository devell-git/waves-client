/**
 * Extração de texto de planilhas (XLSX/XLS/XLSM) — isolada num módulo único
 * pra facilitar troca da lib xlsx@0.18.5 (CVEs conhecidos) sem tocar uploads.
 */
import * as XLSX from "xlsx";

/** Converte buffer de planilha em texto (cada sheet vira bloco CSV). */
export function spreadsheetToText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) parts.push(`## ${name}\n${csv.trim()}`);
  }
  return parts.join("\n\n");
}
