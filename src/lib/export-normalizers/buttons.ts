/** Remove todos os botões (follow-ups, ações, export). */
export function normalizeButtons(clone: HTMLElement): void {
  // Remove data-slot buttons (follow-ups)
  clone.querySelectorAll<HTMLElement>("[data-slot='button']").forEach((btn) => btn.remove());

  // Remove remaining buttons
  clone.querySelectorAll<HTMLElement>("button").forEach((btn) => btn.remove());

  // Remove role=button
  clone.querySelectorAll<HTMLElement>("[role='button']").forEach((btn) => btn.remove());

  // Remove flex-wrap containers that only had buttons (now empty)
  clone.querySelectorAll<HTMLElement>("[class*='flex-wrap']").forEach((div) => {
    if (!div.textContent?.trim()) div.remove();
  });

  // Remove export wrapper
  clone.querySelectorAll<HTMLElement>(".msg-export-top, .msg-export-wrap").forEach((el) => el.remove());

  // Remove message meta
  clone.querySelectorAll<HTMLElement>(".waves-assistant-message__meta").forEach((el) => el.remove());
}
