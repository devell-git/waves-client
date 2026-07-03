/** Normaliza KPI rows (flex de cards com número grande + label) → tabela com cores. */
export function normalizeKpis(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLElement>("div").forEach((div) => {
    const style = window.getComputedStyle(div);
    if (style.display !== "flex") return;

    const children = Array.from(div.children).filter(
      (c) => c instanceof HTMLElement && c.textContent?.trim(),
    ) as HTMLElement[];
    if (children.length < 2 || children.length > 8) return;

    // Each child should have 1-3 text items (value + label + optional sublabel)
    const isKpi = children.every((child) => {
      const hasLargeText = Array.from(child.querySelectorAll<HTMLElement>("*")).some((el) => {
        const fs = window.getComputedStyle(el).fontSize;
        return fs && parseFloat(fs) >= 18;
      });
      const hasSmallText = Array.from(child.querySelectorAll<HTMLElement>("*")).some((el) => {
        const fs = window.getComputedStyle(el).fontSize;
        return fs && parseFloat(fs) <= 14;
      });
      return hasLargeText || hasSmallText;
    });

    if (!isKpi) return;

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;margin:12px 0;";
    const trLabels = document.createElement("tr");
    const trValues = document.createElement("tr");

    for (const child of children) {
      const childStyle = window.getComputedStyle(child);
      const bg = childStyle.backgroundColor;

      // Find value (large font) and label (small font)
      let valueEl: HTMLElement | null = null;
      let labelEl: HTMLElement | null = null;

      for (const el of Array.from(child.querySelectorAll<HTMLElement>("*"))) {
        const fs = parseFloat(window.getComputedStyle(el).fontSize || "0");
        if (fs >= 18 && !valueEl) valueEl = el;
        else if (fs <= 14 && el.textContent?.trim() && !labelEl) labelEl = el;
      }

      // Label header
      const th = document.createElement("th");
      th.textContent = labelEl?.textContent?.trim() ?? "";
      th.style.cssText = `
        padding:6px 10px;border:1px solid #e2e8f0;
        background:#f1f5f9;font-size:10px;text-transform:uppercase;
        letter-spacing:0.04em;text-align:center;font-weight:600;
      `;
      trLabels.appendChild(th);

      // Value cell
      const td = document.createElement("td");
      td.textContent = valueEl?.textContent?.trim() ?? child.textContent?.trim() ?? "";
      const valueStyle = valueEl ? window.getComputedStyle(valueEl) : null;
      td.style.cssText = `
        padding:10px 12px;border:1px solid #e2e8f0;
        text-align:center;font-weight:700;
        font-size:${valueStyle?.fontSize || '20px'};
        color:${valueStyle?.color || '#1e293b'};
      `;

      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        td.style.backgroundColor = bg;
      }

      trValues.appendChild(td);
    }

    table.appendChild(trLabels);
    table.appendChild(trValues);
    div.replaceWith(table);
  });
}
