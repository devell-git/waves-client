/** Normaliza Alert OpenUI → div com borda lateral colorida + estilos preservados. */
export function normalizeAlerts(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLElement>("[data-slot='alert']").forEach((alert) => {
    const div = document.createElement("div");
    const computed = window.getComputedStyle(alert);

    // Detectar tipo pelo cor/classe
    const bg = computed.backgroundColor;
    const borderColor = computed.borderColor || "#6366f1";

    div.style.cssText = `
      border-left:4px solid ${borderColor};
      background:${bg || '#f0f4ff'};
      padding:12px 16px;
      margin:10px 0;
      border-radius:0 6px 6px 0;
      color:${computed.color || '#1e293b'};
    `;

    // alert-title → strong
    const title = alert.querySelector<HTMLElement>("[data-slot='alert-title']");
    if (title) {
      const strong = document.createElement("strong");
      strong.textContent = title.textContent?.trim() ?? "";
      const titleStyle = window.getComputedStyle(title);
      strong.style.cssText = `
        display:block;
        font-weight:700;
        color:${titleStyle.color || computed.color || '#0f172a'};
        margin-bottom:4px;
        font-size:${titleStyle.fontSize || '13px'};
      `;
      div.appendChild(strong);
    }

    // alert-description → p
    const desc = alert.querySelector<HTMLElement>("[data-slot='alert-description']");
    if (desc) {
      const p = document.createElement("p");
      p.textContent = desc.textContent?.trim() ?? "";
      const descStyle = window.getComputedStyle(desc);
      p.style.cssText = `
        color:${descStyle.color || '#475569'};
        font-size:${descStyle.fontSize || '12px'};
        margin:0;
        line-height:1.5;
      `;
      div.appendChild(p);
    }

    alert.replaceWith(div);
  });
}
