/**
 * Barra de ações de mensagem — Download (PDF/Word), Copiar, Expandir.
 * Aparece no canto superior direito de cada mensagem do assistente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Copy, Check, Maximize2, Minimize2 } from "lucide-react";
import { normalizeForExport } from "../lib/export-normalizers";

const PdfIcon = () => (
  <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="#E2574C"/>
    <text x="16" y="21" textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="Arial,sans-serif">PDF</text>
  </svg>
);

const WordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="#2B579A"/>
    <text x="16" y="21" textAnchor="middle" fill="white" fontSize="12" fontWeight="700" fontFamily="Arial,sans-serif">W</text>
  </svg>
);

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

  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const msgEl = btn.closest(".waves-assistant-message");
    if (!msgEl) return;
    const contentEl = msgEl.querySelector(
      ".openui-shell-thread-message-assistant__content",
    ) as HTMLElement | null;
    if (!contentEl) return;

    // Clone and normalize (same pipeline as export)
    const clone = contentEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".msg-actions-bar, .msg-actions-top, .msg-export-top, .msg-expand-close, .waves-assistant-message__meta, button, [role='button']").forEach((el) => el.remove());
    clone.querySelectorAll("[class*='follow-up'], [class*='FollowUp'], [class*='followup'], [class*='suggestion']").forEach((el) => el.remove());

    // Inline computed styles (same as export)
    const origElements = contentEl.querySelectorAll("*");
    const cloneElements = clone.querySelectorAll("*");
    const importantProps = [
      "color", "background-color", "font-size", "font-weight",
      "border", "padding", "margin", "display", "text-align",
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

    // Normalize OpenUI components to semantic HTML
    normalizeForExport(clone);

    // Copy as rich text (HTML) + plain text fallback
    const html = clone.innerHTML;
    const text = clone.textContent?.trim() ?? "";

    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([text], { type: "text/plain" });

    navigator.clipboard.write([
      new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      }),
    ]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: plain text only
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    });
  }, []);

  const handleExpand = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const msgEl = btn.closest(".waves-assistant-message");
    if (!msgEl) return;
    const contentEl = msgEl.querySelector(
      ".openui-shell-thread-message-assistant__content",
    ) as HTMLElement | null;
    if (!contentEl) return;

    if (expanded) {
      contentEl.classList.remove("msg-expanded");
      // Remove close button
      contentEl.querySelector(".msg-expand-close")?.remove();
      setExpanded(false);
    } else {
      contentEl.classList.add("msg-expanded");
      // Add close (X) button at top-right of expanded view
      const closeBtn = document.createElement("button");
      closeBtn.className = "msg-expand-close";
      closeBtn.innerHTML = "✕";
      closeBtn.title = "Fechar";
      closeBtn.onclick = () => {
        contentEl.classList.remove("msg-expanded");
        closeBtn.remove();
        setExpanded(false);
      };
      contentEl.prepend(closeBtn);
      setExpanded(true);
    }
  }, [expanded]);

  return (
    <span className="msg-actions-bar">
      {/* Copy */}
      <button
        type="button"
        className="msg-action-btn"
        onClick={handleCopy}
        title="Copiar texto"
        aria-label="Copiar texto"
      >
        {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
      </button>

      {/* Expand */}
      <button
        type="button"
        className="msg-action-btn"
        onClick={handleExpand}
        title={expanded ? "Recolher" : "Expandir"}
        aria-label={expanded ? "Recolher" : "Expandir"}
      >
        {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
      </button>

      {/* Download */}
      <button
        ref={btnRef}
        type="button"
        className="msg-action-btn"
        onClick={() => setOpen((v) => !v)}
        title="Exportar mensagem"
        aria-label="Exportar mensagem"
        disabled={exporting}
      >
        {exporting ? (
          <span className="msg-export-spinner" />
        ) : (
          <Download size={14} strokeWidth={2} />
        )}
      </button>

      {open && (
        <div ref={menuRef} className="msg-export-menu">
          <button
            type="button"
            className="msg-export-option"
            onClick={() => exportAs("pdf")}
          >
            <PdfIcon /> PDF
          </button>
          <button
            type="button"
            className="msg-export-option"
            onClick={() => exportAs("docx")}
          >
            <WordIcon /> Word
          </button>
        </div>
      )}
    </span>
  );
}
