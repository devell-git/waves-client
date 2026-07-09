/**
 * Barra de ações de mensagem — Download (PDF/Word), Copiar, Expandir.
 * Aparece no canto superior direito de cada mensagem do assistente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Copy, Check, Maximize2, X } from "lucide-react";
import { normalizeForExport } from "../lib/export-normalizers";
import { loadSession } from "../lib/session";

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

/** Resolve o contentEl a partir de qualquer elemento dentro da mensagem */
function findContentEl(el: HTMLElement): HTMLElement | null {
  const msg = el.closest(".waves-assistant-message");
  if (!msg) return null;
  return msg.querySelector(".openui-shell-thread-message-assistant__content") as HTMLElement | null;
}

export function MessageExport() {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const barRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        barRef.current?.contains(e.target as Node)
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

      const bar = barRef.current;
      if (!bar) { setExporting(false); return; }

      const contentEl = findContentEl(bar);
      if (!contentEl) { setExporting(false); return; }

      try {
        const clone = contentEl.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".waves-assistant-message__meta, .msg-actions-top, .msg-actions-bar, .msg-expand-close, .msg-export-wrap, button, [role='button']").forEach((el) => el.remove());
        clone.querySelectorAll("[class*='follow-up'], [class*='FollowUp'], [class*='followup'], [class*='suggestion']").forEach((el) => el.remove());

        clone.querySelectorAll("details").forEach((det) => {
          det.setAttribute("open", "");
        });

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

        normalizeForExport(clone);

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
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
</style></head>
<body data-theme="${document.body.getAttribute("data-theme") || "light"}">
<div class="openui-shell-thread-message-assistant__content">
${clone.innerHTML}
</div></body></html>`;

        const token = loadSession()?.accessToken;
        const response = await fetch("/api/export-message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
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

  const handleCopy = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const contentEl = findContentEl(bar);
    if (!contentEl) return;

    const clone = contentEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".msg-actions-bar, .msg-actions-top, .msg-expand-close, .waves-assistant-message__meta, button, [role='button']").forEach((el) => el.remove());
    clone.querySelectorAll("[class*='follow-up'], [class*='FollowUp'], [class*='followup'], [class*='suggestion']").forEach((el) => el.remove());

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

    normalizeForExport(clone);

    const html = clone.innerHTML;
    const text = clone.textContent?.trim() ?? "";
    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([text], { type: "text/plain" });

    navigator.clipboard.write([
      new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob }),
    ]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    });
  }, []);

  const handleExpand = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const contentEl = findContentEl(bar);
    if (!contentEl) return;

    const isExpanded = contentEl.classList.contains("msg-expanded");
    if (isExpanded) {
      contentEl.classList.remove("msg-expanded");
      contentEl.querySelector(".msg-expand-close")?.remove();
      setExpanded(false);
    } else {
      contentEl.classList.add("msg-expanded");
      const closeBtn = document.createElement("button");
      closeBtn.className = "msg-expand-close";
      closeBtn.title = "Fechar";
      closeBtn.setAttribute("aria-label", "Fechar");
      closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      closeBtn.onclick = () => {
        contentEl.classList.remove("msg-expanded");
        closeBtn.remove();
        setExpanded(false);
      };
      contentEl.prepend(closeBtn);
      setExpanded(true);
    }
  }, []);

  return (
    <span className="msg-actions-bar" ref={barRef}>
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
        {expanded ? <X size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
      </button>

      {/* Download */}
      <button
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
