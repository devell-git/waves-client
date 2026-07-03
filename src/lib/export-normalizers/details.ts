/** Força todos os colapsáveis abertos para exportação completa.
 * Cobre: <details>, Radix Accordion (data-state=closed), e Collapsible.
 */
export function normalizeDetails(clone: HTMLElement): void {
  // HTML details
  clone.querySelectorAll("details").forEach((det) => {
    det.setAttribute("open", "");
  });

  // Radix Accordion items (data-state="closed" → "open")
  clone.querySelectorAll<HTMLElement>("[data-state='closed']").forEach((el) => {
    el.setAttribute("data-state", "open");
    // Show hidden content
    el.style.display = "";
    el.style.height = "auto";
    el.style.overflow = "visible";
  });

  // Hidden accordion content panels
  clone.querySelectorAll<HTMLElement>("[hidden], [aria-hidden='true']").forEach((el) => {
    // Only unhide content panels, not decorative elements
    if (el.textContent?.trim() && el.textContent.trim().length > 5) {
      el.removeAttribute("hidden");
      el.removeAttribute("aria-hidden");
      el.style.display = "";
      el.style.height = "auto";
    }
  });
}
