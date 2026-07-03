/**
 * OpenUI Normalizer — converte componentes OpenUI (Tailwind divs) em HTML semântico
 * para exportação fidedigna em PDF/Word.
 *
 * Roda no clone do DOM ANTES de enviar ao backend. Transforma padrões visuais
 * (flex, rounded-xl, gap-6) em tags semânticas (table, h1, ul, section) que
 * weasyprint e python-docx entendem.
 */

/** Remove SVGs (ícones) e substitui por texto equivalente */
function replaceSvgs(el: HTMLElement): void {
  el.querySelectorAll("svg").forEach((svg) => {
    const parent = svg.parentElement;
    // Checkbox SVG → text
    if (parent?.classList.contains("shrink-0") || parent?.classList.contains("mt-0.5")) {
      const isChecked = svg.querySelector("[data-checked]") || svg.innerHTML.includes("check");
      const span = document.createElement("span");
      span.textContent = isChecked ? "☑ " : "☐ ";
      svg.replaceWith(span);
    } else {
      svg.remove();
    }
  });
}

/** Detecta se elemento é um KPI card (número grande + label pequeno) */
function isKpiCard(el: HTMLElement): boolean {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length < 2) return false;
  const hasLargeNum = children.some((c) => {
    const fs = window.getComputedStyle(c).fontSize;
    return fs && parseFloat(fs) >= 20;
  });
  const hasSmallLabel = children.some((c) => {
    const fs = window.getComputedStyle(c).fontSize;
    return fs && parseFloat(fs) <= 13;
  });
  return hasLargeNum && hasSmallLabel;
}

/** Detecta se é um container flex de KPIs */
function isKpiRow(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display !== "flex") return false;
  const children = Array.from(el.children) as HTMLElement[];
  return children.length >= 2 && children.every((c) => isKpiCard(c));
}

/** Converte row de KPIs em tabela HTML */
function kpiRowToTable(el: HTMLElement): HTMLElement {
  const children = Array.from(el.children) as HTMLElement[];
  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;margin:12px 0;";

  const headerRow = document.createElement("tr");
  const valueRow = document.createElement("tr");

  for (const child of children) {
    const texts = Array.from(child.children) as HTMLElement[];
    const value = texts.find((t) => {
      const fs = window.getComputedStyle(t).fontSize;
      return fs && parseFloat(fs) >= 20;
    });
    const label = texts.find((t) => {
      const fs = window.getComputedStyle(t).fontSize;
      return fs && parseFloat(fs) <= 13;
    });

    const th = document.createElement("th");
    th.textContent = label?.textContent?.trim() ?? "";
    th.style.cssText = "padding:8px 12px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;text-align:center;";
    headerRow.appendChild(th);

    const td = document.createElement("td");
    td.textContent = value?.textContent?.trim() ?? "";
    // Copy color from original
    if (value) {
      const color = window.getComputedStyle(value).color;
      const fw = window.getComputedStyle(value).fontWeight;
      td.style.cssText = `padding:8px 12px;border:1px solid #e2e8f0;text-align:center;font-size:20px;font-weight:${fw};color:${color};`;
    } else {
      td.style.cssText = "padding:8px 12px;border:1px solid #e2e8f0;text-align:center;font-size:20px;font-weight:700;";
    }

    // Background from KPI card
    const bg = window.getComputedStyle(child).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      td.style.backgroundColor = bg;
    }

    valueRow.appendChild(td);
  }

  table.appendChild(headerRow);
  table.appendChild(valueRow);
  return table;
}

/** Detecta se é uma lista de items repetitivos (cards empilhados = tasks) */
function isRepeatedCardList(el: HTMLElement): boolean {
  const children = Array.from(el.children).filter(
    (c) => c instanceof HTMLElement && c.textContent?.trim(),
  ) as HTMLElement[];
  if (children.length < 3) return false;

  // Check if children have similar structure (same tag, similar class count)
  const firstClasses = children[0].className.split(" ").length;
  const allSimilar = children.every((c) => {
    const cls = c.className.split(" ").length;
    return Math.abs(cls - firstClasses) <= 2 && c.tagName === children[0].tagName;
  });
  return allSimilar;
}

/** Converte lista de cards repetitivos em tabela */
function repeatedCardsToTable(el: HTMLElement): HTMLElement | null {
  const children = Array.from(el.children).filter(
    (c) => c instanceof HTMLElement && c.textContent?.trim(),
  ) as HTMLElement[];
  if (children.length < 2) return null;

  // Extract text content from each card as columns
  const rows: string[][] = [];
  for (const child of children) {
    const texts: string[] = [];
    // Walk leaf text nodes
    const walk = (node: HTMLElement) => {
      for (const c of Array.from(node.children) as HTMLElement[]) {
        const text = c.textContent?.trim() ?? "";
        if (text && !c.querySelector("*")?.children.length) {
          texts.push(text);
        } else if (c.children.length) {
          walk(c);
        }
      }
    };
    walk(child);
    if (texts.length > 0) rows.push(texts);
  }

  if (rows.length < 2) return null;

  // Normalize column count
  const maxCols = Math.max(...rows.map((r) => r.length));
  if (maxCols < 2 || maxCols > 10) return null;

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;margin:12px 0;";

  for (let i = 0; i < rows.length; i++) {
    const tr = document.createElement("tr");
    for (let j = 0; j < maxCols; j++) {
      const td = document.createElement("td");
      td.textContent = rows[i][j] ?? "";
      td.style.cssText = "padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;";
      if (i % 2 === 1) td.style.backgroundColor = "#f8fafc";
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  return table;
}

/** Converte Card OpenUI em section HTML semântica */
function normalizeCard(card: HTMLElement): void {
  // Card header → h3
  const headers = card.querySelectorAll<HTMLElement>(".leading-none.font-semibold, [class*='font-semibold']:first-child");
  headers.forEach((h) => {
    const h3 = document.createElement("h3");
    h3.textContent = h.textContent?.trim() ?? "";
    h3.style.cssText = "font-size:14pt;font-weight:600;margin:8px 0 4px;";
    h.replaceWith(h3);
  });

  // Subtitle → p.muted
  card.querySelectorAll<HTMLElement>(".text-muted-foreground, [class*='text-muted']").forEach((sub) => {
    const p = document.createElement("p");
    p.textContent = sub.textContent?.trim() ?? "";
    p.style.cssText = "color:#64748b;font-size:12px;margin:2px 0;";
    sub.replaceWith(p);
  });
}

/**
 * Normaliza o HTML clonado de um card OpenUI para export.
 * Chama ANTES de enviar ao backend.
 */
export function normalizeForExport(clone: HTMLElement): void {
  // 1. Remove SVGs (ícones)
  replaceSvgs(clone);

  // 2. Convert KPI rows to tables
  clone.querySelectorAll<HTMLElement>("div").forEach((div) => {
    if (isKpiRow(div)) {
      const table = kpiRowToTable(div);
      div.replaceWith(table);
    }
  });

  // 3. Normalize Card headers
  clone.querySelectorAll<HTMLElement>("[class*='flex'][class*='flex-col'][class*='gap-6'], [class*='rounded-xl'][class*='border']").forEach((card) => {
    normalizeCard(card);
  });

  // 4. Convert repeated card lists to tables
  clone.querySelectorAll<HTMLElement>("[class*='space-y']").forEach((list) => {
    if (isRepeatedCardList(list)) {
      const table = repeatedCardsToTable(list);
      if (table) list.replaceWith(table);
    }
  });

  // 5. Ordered lists → keep as ol
  // (already semantic, just ensure styling)
  clone.querySelectorAll("ol").forEach((ol) => {
    ol.style.cssText = "list-style-type:decimal;padding-left:20px;margin:8px 0;";
  });
  clone.querySelectorAll("ul").forEach((ul) => {
    ul.style.cssText = "list-style-type:disc;padding-left:20px;margin:8px 0;";
  });

  // 6. Ensure all text paragraphs have basic styling
  clone.querySelectorAll<HTMLElement>(".text-base, p").forEach((p) => {
    if (!p.style.fontSize) p.style.fontSize = "11pt";
    if (!p.style.lineHeight) p.style.lineHeight = "1.5";
  });
}
