/**
 * Botão de exportação de mensagem (↓) — Word ou PDF.
 * Aparece no rodapé de cada mensagem do assistente.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

        // Colapsáveis fechados: manter só o summary, remover conteúdo interno
        clone.querySelectorAll("details:not([open])").forEach((det) => {
          const summary = det.querySelector("summary");
          if (summary) {
            const p = document.createElement("p");
            p.innerHTML = `<strong>${summary.textContent}</strong> <em>(colapsado)</em>`;
            det.replaceWith(p);
          } else {
            det.remove();
          }
        });
        // Colapsáveis abertos: remover o tag details/summary, manter conteúdo
        clone.querySelectorAll("details[open]").forEach((det) => {
          const div = document.createElement("div");
          div.innerHTML = det.innerHTML;
          div.querySelector("summary")?.remove();
          det.replaceWith(div);
        });

        // Capturar os estilos computados e inline-ar
        const styles = Array.from(document.styleSheets)
          .map((sheet) => {
            try { return Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"); }
            catch { return ""; }
          })
          .join("\n");

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
