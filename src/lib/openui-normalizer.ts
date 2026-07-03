/**
 * OpenUI Normalizer v2 — usa data-slot attributes para conversão precisa.
 *
 * OpenUI renderiza com data-slot="card", "card-title", "card-content", etc.
 * Este normalizer converte para HTML semântico que weasyprint e python-docx entendem.
 */

export function normalizeForExport(clone: HTMLElement): void {
  // 1. Remove ALL SVGs (ícones, checkboxes visuais, chevrons)
  clone.querySelectorAll("svg").forEach((svg) => svg.remove());

  // 2. Remove chevron buttons and expand indicators
  clone.querySelectorAll("[aria-hidden='true']").forEach((el) => {
    if (!el.textContent?.trim()) el.remove();
  });

  // 3. Card title → h2
  clone.querySelectorAll<HTMLElement>("[data-slot='card-title']").forEach((el) => {
    const h2 = document.createElement("h2");
    h2.textContent = el.textContent?.trim() ?? "";
    h2.style.cssText = "font-size:16pt;font-weight:700;color:#0f172a;margin:0 0 4px;border-bottom:2px solid #6366f1;padding-bottom:4px;";
    el.replaceWith(h2);
  });

  // 4. Card description → p.subtitle
  clone.querySelectorAll<HTMLElement>("[data-slot='card-description']").forEach((el) => {
    const p = document.createElement("p");
    p.textContent = el.textContent?.trim() ?? "";
    p.style.cssText = "color:#64748b;font-size:12px;margin:0 0 12px;";
    el.replaceWith(p);
  });

  // 5. Card header → remove wrapper (content already converted)
  clone.querySelectorAll<HTMLElement>("[data-slot='card-header']").forEach((el) => {
    const div = document.createElement("div");
    div.innerHTML = el.innerHTML;
    el.replaceWith(div);
  });

  // 6. Card → section with border
  clone.querySelectorAll<HTMLElement>("[data-slot='card']").forEach((card) => {
    const section = document.createElement("section");
    section.innerHTML = card.innerHTML;
    section.style.cssText = "border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:12px 0;background:#fff;";
    card.replaceWith(section);
  });

  // 7. Checklist items (ol > li with checkbox pattern) → clean numbered list
  clone.querySelectorAll<HTMLElement>("ol").forEach((ol) => {
    const items = ol.querySelectorAll("li");
    const newOl = document.createElement("ol");
    newOl.style.cssText = "list-style-type:decimal;padding-left:24px;margin:8px 0;";

    items.forEach((li) => {
      // Extract just the text content (skip SVGs already removed)
      const textDivs = li.querySelectorAll<HTMLElement>("[class*='leading-snug'], [class*='text-sm'], [class*='flex-1'] > div");
      let text = "";
      if (textDivs.length > 0) {
        text = Array.from(textDivs).map((d) => d.textContent?.trim()).filter(Boolean).join(" ");
      }
      if (!text) {
        // Fallback: get all text, clean up
        text = li.textContent?.trim() ?? "";
      }

      if (text) {
        const newLi = document.createElement("li");
        newLi.textContent = text;
        newLi.style.cssText = "margin:4px 0;font-size:11pt;line-height:1.5;padding:4px 0;";
        newOl.appendChild(newLi);
      }
    });

    if (newOl.children.length > 0) {
      ol.replaceWith(newOl);
    }
  });

  // 8. Unordered lists
  clone.querySelectorAll<HTMLElement>("ul").forEach((ul) => {
    ul.style.cssText = "list-style-type:disc;padding-left:24px;margin:8px 0;";
    ul.querySelectorAll("li").forEach((li) => {
      li.style.cssText = "margin:3px 0;font-size:11pt;";
    });
  });

  // 9. Section headers (font-semibold divs that aren't card-title)
  clone.querySelectorAll<HTMLElement>("div").forEach((div) => {
    const cls = div.className || "";
    if (cls.includes("font-semibold") && !div.querySelector("*") && div.textContent?.trim()) {
      const h3 = document.createElement("h3");
      h3.textContent = div.textContent.trim();
      h3.style.cssText = "font-size:13pt;font-weight:600;color:#334155;margin:12px 0 6px;";
      div.replaceWith(h3);
    }
  });

  // 10. Text paragraphs
  clone.querySelectorAll<HTMLElement>("p").forEach((p) => {
    if (!p.style.fontSize) p.style.fontSize = "11pt";
    if (!p.style.lineHeight) p.style.lineHeight = "1.5";
    if (!p.style.margin) p.style.margin = "6px 0";
  });

  // 11. KPI detection: divs with large number + small label
  clone.querySelectorAll<HTMLElement>("div").forEach((div) => {
    const children = Array.from(div.children) as HTMLElement[];
    if (children.length < 2 || children.length > 6) return;

    // Check if this looks like a KPI row (flex container of KPI cards)
    const display = window.getComputedStyle(div).display;
    if (display !== "flex") return;

    const allKpi = children.every((child) => {
      const texts = child.textContent?.trim().split("\n").map((t) => t.trim()).filter(Boolean) ?? [];
      return texts.length >= 1 && texts.length <= 3;
    });

    if (!allKpi || children.length < 2) return;

    // Convert to table
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;margin:12px 0;";
    const trHead = document.createElement("tr");
    const trVal = document.createElement("tr");

    for (const child of children) {
      const texts = child.textContent?.trim().split("\n").map((t) => t.trim()).filter(Boolean) ?? [];
      const bg = window.getComputedStyle(child).backgroundColor;

      // Determine which is value (shorter, usually first) and label
      let value = texts[0] ?? "";
      let label = texts[1] ?? "";
      // If first text is longer, swap
      if (value.length > label.length && label.length > 0) {
        [value, label] = [label, value];
      }

      const th = document.createElement("th");
      th.textContent = label;
      th.style.cssText = "padding:6px 10px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:10px;text-transform:uppercase;text-align:center;";
      trHead.appendChild(th);

      const td = document.createElement("td");
      td.textContent = value;
      td.style.cssText = `padding:8px 10px;border:1px solid #e2e8f0;text-align:center;font-size:18px;font-weight:700;`;

      // Preserve background color
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        td.style.backgroundColor = bg;
      }

      // Preserve text color from computed style
      const valEl = Array.from(child.children).find((c) => {
        const fs = window.getComputedStyle(c as HTMLElement).fontSize;
        return fs && parseFloat(fs) >= 18;
      }) as HTMLElement | undefined;
      if (valEl) {
        td.style.color = window.getComputedStyle(valEl).color;
      }

      trVal.appendChild(td);
    }

    table.appendChild(trHead);
    table.appendChild(trVal);
    div.replaceWith(table);
  });

  // 12. Remove empty divs and clean up spacing
  clone.querySelectorAll<HTMLElement>("div").forEach((div) => {
    if (!div.textContent?.trim() && !div.querySelector("table, section, h2, h3, ol, ul, img")) {
      div.remove();
    }
  });

  // 13. Force details open
  clone.querySelectorAll("details").forEach((det) => {
    det.setAttribute("open", "");
  });

  // 14. Tables: ensure styling
  clone.querySelectorAll<HTMLElement>("table").forEach((table) => {
    if (!table.style.borderCollapse) {
      table.style.cssText += ";width:100%;border-collapse:collapse;margin:8px 0;";
    }
    table.querySelectorAll("th").forEach((th) => {
      if (!th.style.border) th.style.cssText += ";border:1px solid #e2e8f0;padding:8px 10px;background:#f1f5f9;font-size:11px;text-align:left;";
    });
    table.querySelectorAll("td").forEach((td) => {
      if (!td.style.border) td.style.cssText += ";border:1px solid #e2e8f0;padding:8px 10px;";
    });
  });
}
