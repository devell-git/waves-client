/** Remove SVGs e substitui checkboxes por texto. */
export function cleanupSvgs(clone: HTMLElement): void {
  clone.querySelectorAll("svg").forEach((svg) => {
    // Checkbox SVG → ☐/☑
    const rect = svg.querySelector("rect");
    const check = svg.querySelector("polyline, path[d*='M20 6']");
    if (rect && rect.getAttribute("width") === "18") {
      const span = document.createElement("span");
      span.textContent = check ? "☑ " : "☐ ";
      span.style.cssText = "font-size:14px;margin-right:4px;";
      svg.replaceWith(span);
      return;
    }
    // Chevron (expand) → remove
    const chevron = svg.querySelector("path[d*='m6 9']");
    if (chevron) {
      svg.remove();
      return;
    }
    // Other SVGs → remove
    svg.remove();
  });

  // Remove aria-hidden empty elements
  clone.querySelectorAll("[aria-hidden='true']").forEach((el) => {
    if (!el.textContent?.trim()) el.remove();
  });
}
