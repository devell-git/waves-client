/**
 * Botão de exportação de mensagem (↓) — Word ou PDF.
 * Aparece no rodapé de cada mensagem do assistente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeForExport } from "../lib/export-normalizers";

export function MessageExport() {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const exportAs = useCallback(
    async (format: "pdf" | "docx") => {
      setExporting(true);
      setOpen(false);

      const btn = btnRef.current;
      if (!btn) { setExporting(false); return; }

      const msgEl = btn.closest(".waves-assistant-message");
      if (!msgEl) { setExporting(false); return; }

      const contentEl = msgEl.querySelector(
        ".openui-shell-thread-message-assistant__content",
      ) as HTMLElement | null;
      if (!contentEl) { setExporting(false); return; }

      try {
        // Captura o HTML renderizado COM estilos computados (cores, backgrounds, tudo)
        const clone = contentEl.cloneNode(true) as HTMLElement;
        // Remover meta e botões
        clone.querySelectorAll(".waves-assistant-message__meta, .msg-export-top, .msg-export-wrap, button, [role='button']").forEach((el) => el.remove());
        // Remover follow-ups
        clone.querySelectorAll("[class*='follow-up'], [class*='FollowUp'], [class*='followup'], [class*='suggestion']").forEach((el) => el.remove());

        // Todos os colapsáveis: forçar aberto (exportar conteúdo completo)
        clone.querySelectorAll("details").forEach((det) => {
          det.setAttribute("open", "");
        });

        // Inline-ar computed styles de cada elemento (captura Tailwind/CSS vars)
        const origElements = contentEl.querySelectorAll("*");
        const cloneElements = clone.querySelectorAll("*");
        const importantProps = [
          "color", "background-color", "background", "font-size", "font-weight",
          "font-family", "border", "border-radius", "padding", "margin",
          "display", "flex-direction", "gap", "align-items", "justify-content",
          "text-align", "line-height", "width", "max-width", "min-width",
          "border-bottom", "border-top", "border-left", "border-right",
          "box-shadow", "opacity", "text-transform", "letter-spacing",
        ];
        for (let i = 0; i < Math.min(origElements.length, cloneElements.length); i++) {
          const computed = window.getComputedStyle(origElements[i]);
          const inlineStyles: string[] = [];
          for (const prop of importantProps) {
            const val = computed.getPropertyValue(prop);
            if (val && val !== "none" && val !== "normal" && val !== "0px" && val !== "auto" && val !== "rgba(0, 0, 0, 0)") {
              inlineStyles.push(`${prop}:${val}`);
            }
          }
          if (inlineStyles.length > 0) {
            (cloneElements[i] as HTMLElement).style.cssText += ";" + inlineStyles.join(";");
          }
        }

        // Normalizar OpenUI → HTML semântico (KPIs→table, cards→sections, etc.)
        normalizeForExport(clone);

        // CSS mínimo para o PDF (reset + print colors)
        const styles = `
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { font-family: 'Inter', system-ui, sans-serif; padding: 24px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e2e8f0; padding: 8px; }
        `;

        const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
${styles}
body { padding: 24px; background: white; }
/* Force print-friendly */
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
</style></head>
<body data-theme="${document.body.getAttribute("data-theme") || "light"}">
<div class="openui-shell-thread-message-assistant__content">
${clone.innerHTML}
</div></body></html>`;

        const response = await fetch("/api/export-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, html: fullHtml, text: clone.textContent?.trim() ?? "" }),
        });

        if (!response.ok) {
          console.error("Export failed:", response.status);
          setExporting(false);
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mensagem.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Export error:", err);
      }
      setExporting(false);
    },
    [],
  );

  return (
    <span className="msg-export-wrap">
      <button
        ref={btnRef}
        type="button"
        className="msg-export-btn"
        onClick={() => setOpen((v) => !v)}
        title="Exportar mensagem"
        aria-label="Exportar mensagem"
        disabled={exporting}
      >
        {exporting ? "⏳" : "↓"}
      </button>
      {open && (
        <div ref={menuRef} className="msg-export-menu">
          <button
            type="button"
            className="msg-export-option"
            onClick={() => exportAs("pdf")}
          >
            PDF
          </button>
          <button
            type="button"
            className="msg-export-option"
            onClick={() => exportAs("docx")}
          >
            Word
          </button>
        </div>
      )}
    </span>
  );
}
