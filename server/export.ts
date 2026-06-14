/**
 * Export de documento em vários formatos a partir do HTML montado pelo runtime.
 *
 * PDF é nativo da Waves (DocumentType/timbrado) — não passa por aqui. Aqui
 * cobrimos os formatos que a Waves NÃO gera:
 *   - **docx** (Word REAL): via `@turbodocx/html-to-docx` (HTML → .docx de
 *     verdade, editável, tabelas/títulos preservados). É o formato recomendado.
 *   - doc: HTML empacotado como `application/msword` (fallback leve, sem lib).
 *   - html: o próprio HTML como arquivo.
 *
 * `POST /api/export { html, filename, format: "docx" | "doc" | "html" }`.
 */
import { Router } from "express";
import HtmlToDocx from "@turbodocx/html-to-docx";

export const exportRouter = Router();

function safeName(v: unknown): string {
  return String(v ?? "documento").replace(/[^\w.\- ]+/g, "_").trim().slice(0, 120) || "documento";
}

function wrapHtml(title: string, body: string, word: boolean): string {
  const ns = word
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
    : "";
  return `<!doctype html><html${ns}><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

exportRouter.post("/", async (req, res) => {
  const b = (req.body ?? {}) as { html?: unknown; filename?: unknown; format?: unknown };
  const html = typeof b.html === "string" ? b.html : "";
  if (!html.trim()) return res.status(400).json({ error: "html obrigatório" });
  const name = safeName(b.filename);
  const format = String(b.format ?? "docx").toLowerCase();

  // Word REAL (.docx) via html-to-docx — editável, tabelas com borda preservadas.
  if (format === "docx") {
    try {
      const buf = (await HtmlToDocx(wrapHtml(name, html, false), undefined, {
        title: name,
        table: { row: { cantSplit: true } },
      })) as ArrayBuffer | Buffer;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${name}.docx"`);
      return res.end(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao gerar .docx" });
    }
  }

  // Word leve (.doc) — HTML como application/msword (fallback sem lib).
  if (format === "doc" || format === "word") {
    res.setHeader("Content-Type", "application/msword");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.doc"`);
    return res.send(wrapHtml(name, html, true));
  }
  if (format === "html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.html"`);
    return res.send(wrapHtml(name, html, false));
  }
  return res.status(400).json({ error: "format inválido (use docx | doc | html)" });
});
