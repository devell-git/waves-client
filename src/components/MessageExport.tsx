/**
 * Botão de exportação de mensagem (↓) — Word ou PDF.
 * Aparece no rodapé de cada mensagem do assistente.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** Conteúdo da mensagem (texto ou HTML renderizado) */
  messageId?: string;
}

export function MessageExport({ messageId }: Props) {
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

  const getMessageContent = useCallback((): { text: string; html: string } => {
    // Busca o conteúdo renderizado da mensagem mais próxima
    const btn = btnRef.current;
    if (!btn) return { text: "", html: "" };

    const msgEl = btn.closest(".waves-assistant-message");
    if (!msgEl) return { text: "", html: "" };

    const contentEl = msgEl.querySelector(
      ".openui-shell-thread-message-assistant__content",
    );
    if (!contentEl) return { text: "", html: "" };

    // Clone sem o meta (horário/tokens/export button)
    const clone = contentEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".waves-assistant-message__meta").forEach((el) => el.remove());

    return {
      text: clone.textContent?.trim() ?? "",
      html: clone.innerHTML,
    };
  }, []);

  const exportAs = useCallback(
    async (format: "pdf" | "docx") => {
      setExporting(true);
      setOpen(false);

      const { text, html } = getMessageContent();
      if (!text && !html) {
        setExporting(false);
        return;
      }

      try {
        const response = await fetch("/api/export-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, html, text, messageId }),
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
        a.download = `mensagem${messageId ? `-${messageId.slice(0, 8)}` : ""}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Export error:", err);
      }
      setExporting(false);
    },
    [getMessageContent, messageId],
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
