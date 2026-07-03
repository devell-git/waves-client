/** Força todos os colapsáveis abertos para exportação completa.
 * Cobre: OpenUI Accordion (data-slot), <details>, Radix genérico, Collapsible.
 */
export function normalizeDetails(clone: HTMLElement): void {
  // ─── OpenUI Accordion (data-slot="accordion") ───
  clone.querySelectorAll<HTMLElement>("[data-slot='accordion']").forEach((accordion) => {
    const container = document.createElement("div");
    container.style.cssText = "margin:12px 0;";

    accordion.querySelectorAll<HTMLElement>("[data-slot='accordion-item']").forEach((item) => {
      const section = document.createElement("div");
      section.style.cssText = "margin-bottom:12px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;";

      // Trigger → heading
      const trigger = item.querySelector<HTMLElement>("[data-slot='accordion-trigger']");
      if (trigger) {
        const heading = document.createElement("div");
        // Get text without chevron SVG
        const triggerText = trigger.textContent?.trim() ?? "";
        heading.textContent = triggerText;
        heading.style.cssText = `
          padding:10px 14px;
          background:#f1f5f9;
          font-weight:600;
          font-size:13px;
          color:#0f172a;
          border-bottom:1px solid #e2e8f0;
        `;
        section.appendChild(heading);
      }

      // Content → body (forced open regardless of data-state)
      const content = item.querySelector<HTMLElement>("[data-slot='accordion-content']");
      if (content) {
        const body = document.createElement("div");
        body.style.cssText = "padding:10px 14px;font-size:12px;line-height:1.6;color:#334155;";
        // Copy the inner content (inside the padding wrapper div)
        const innerDiv = content.querySelector<HTMLElement>(":scope > div") || content;
        body.innerHTML = innerDiv.innerHTML;
        // Remove any leftover SVGs/chevrons inside
        body.querySelectorAll("svg").forEach((s) => s.remove());
        section.appendChild(body);
      }

      container.appendChild(section);
    });

    accordion.replaceWith(container);
  });

  // ─── HTML <details> ───
  clone.querySelectorAll("details").forEach((det) => {
    det.setAttribute("open", "");
  });

  // ─── Radix genérico (sem data-slot mas com data-state="closed") ───
  clone.querySelectorAll<HTMLElement>("[data-state='closed']").forEach((el) => {
    el.setAttribute("data-state", "open");
    el.style.display = "";
    el.style.height = "auto";
    el.style.overflow = "visible";
  });

  // ─── Hidden content panels ───
  clone.querySelectorAll<HTMLElement>("[hidden], [aria-hidden='true']").forEach((el) => {
    if (el.textContent?.trim() && el.textContent.trim().length > 5) {
      el.removeAttribute("hidden");
      el.removeAttribute("aria-hidden");
      el.style.display = "";
      el.style.height = "auto";
    }
  });
}
