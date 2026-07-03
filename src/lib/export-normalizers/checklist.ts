/** Normaliza Checklist OpenUI (ol > li com checkbox SVG) → lista numerada limpa. */
export function normalizeChecklists(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLElement>("ol").forEach((ol) => {
    const items = ol.querySelectorAll<HTMLElement>("li");
    if (items.length === 0) return;

    const newOl = document.createElement("ol");
    const olStyle = window.getComputedStyle(ol);
    newOl.style.cssText = `
      list-style-type:decimal;
      padding-left:24px;
      margin:8px 0;
      color:${olStyle.color || '#1e293b'};
    `;

    items.forEach((li) => {
      // Extract meaningful text — skip SVG placeholders (☐/☑ already converted)
      const allText: string[] = [];

      // Prioritize specific content divs
      const contentDivs = li.querySelectorAll<HTMLElement>(
        "[class*='leading-snug'], [class*='text-sm']:not([class*='text-muted']), [class*='flex-1'] div"
      );

      if (contentDivs.length > 0) {
        contentDivs.forEach((d) => {
          const t = d.textContent?.trim();
          if (t && t.length > 2 && t !== "☐" && t !== "☑") allText.push(t);
        });
      }

      // Fallback: get direct text
      if (allText.length === 0) {
        const text = li.textContent?.trim()
          ?.replace(/^[☐☑]\s*/, "")  // remove checkbox chars
          ?.replace(/^\d+\.\s*/, "")   // remove numbering
          ?.trim();
        if (text) allText.push(text);
      }

      const finalText = [...new Set(allText)].join(" — ");
      if (finalText) {
        const newLi = document.createElement("li");
        newLi.textContent = finalText;
        const liStyle = window.getComputedStyle(li);
        newLi.style.cssText = `
          margin:6px 0;
          font-size:${liStyle.fontSize || '11pt'};
          line-height:1.6;
          padding:2px 0;
          color:${liStyle.color || 'inherit'};
        `;
        newOl.appendChild(newLi);
      }
    });

    if (newOl.children.length > 0) {
      ol.replaceWith(newOl);
    }
  });

  // Also handle ul lists
  clone.querySelectorAll<HTMLElement>("ul").forEach((ul) => {
    const ulStyle = window.getComputedStyle(ul);
    ul.style.cssText = `
      list-style-type:disc;
      padding-left:24px;
      margin:8px 0;
      color:${ulStyle.color || 'inherit'};
    `;
    ul.querySelectorAll<HTMLElement>("li").forEach((li) => {
      const liStyle = window.getComputedStyle(li);
      li.style.cssText = `margin:4px 0;font-size:${liStyle.fontSize || '11pt'};line-height:1.5;`;
    });
  });
}
