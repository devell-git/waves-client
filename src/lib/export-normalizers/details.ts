/** Força todos os <details> abertos para exportação completa. */
export function normalizeDetails(clone: HTMLElement): void {
  clone.querySelectorAll("details").forEach((det) => {
    det.setAttribute("open", "");
  });
}
