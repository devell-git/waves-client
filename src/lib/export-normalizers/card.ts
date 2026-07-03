/** Normaliza Card OpenUI → section HTML semântica com estilos inline. */
export function normalizeCards(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLElement>("[data-slot='card']").forEach((card) => {
    const section = document.createElement("section");
    const computed = window.getComputedStyle(card);
    section.style.cssText = `
      border:1px solid ${computed.borderColor || '#e2e8f0'};
      border-radius:${computed.borderRadius || '8px'};
      padding:${computed.padding || '16px'};
      margin:12px 0;
      background:${computed.backgroundColor || '#ffffff'};
      color:${computed.color || '#1e293b'};
    `;

    // card-title → h2
    const title = card.querySelector<HTMLElement>("[data-slot='card-title']");
    if (title) {
      const h2 = document.createElement("h2");
      h2.textContent = title.textContent?.trim() ?? "";
      const titleStyle = window.getComputedStyle(title);
      h2.style.cssText = `
        font-size:${titleStyle.fontSize || '16pt'};
        font-weight:${titleStyle.fontWeight || '700'};
        color:${titleStyle.color || '#0f172a'};
        margin:0 0 4px;
        line-height:1.3;
      `;
      section.appendChild(h2);
    }

    // card-description → p subtitle
    const desc = card.querySelector<HTMLElement>("[data-slot='card-description']");
    if (desc) {
      const p = document.createElement("p");
      p.textContent = desc.textContent?.trim() ?? "";
      const descStyle = window.getComputedStyle(desc);
      p.style.cssText = `
        color:${descStyle.color || '#64748b'};
        font-size:${descStyle.fontSize || '12px'};
        margin:0 0 12px;
      `;
      section.appendChild(p);
    }

    // card-content → copy children (skip already-processed title/desc)
    const content = card.querySelector<HTMLElement>("[data-slot='card-content']");
    const source = content || card;
    for (const child of Array.from(source.children)) {
      const slot = (child as HTMLElement).getAttribute?.("data-slot");
      if (slot === "card-header" || slot === "card-title" || slot === "card-description") continue;
      section.appendChild(child.cloneNode(true));
    }

    card.replaceWith(section);
  });
}
