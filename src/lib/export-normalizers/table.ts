/** Normaliza tabelas — preserva estrutura semântica, adiciona estilos inline. */
export function normalizeTables(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLElement>("table").forEach((table) => {
    const tableStyle = window.getComputedStyle(table);
    table.style.cssText = `
      width:100%;border-collapse:collapse;margin:10px 0;
      background:${tableStyle.backgroundColor || '#fff'};
    `;

    table.querySelectorAll<HTMLElement>("th").forEach((th) => {
      const thStyle = window.getComputedStyle(th);
      th.style.cssText = `
        padding:8px 10px;border:1px solid #e2e8f0;
        background:${thStyle.backgroundColor || '#f1f5f9'};
        color:${thStyle.color || '#334155'};
        font-weight:${thStyle.fontWeight || '600'};
        font-size:${thStyle.fontSize || '11px'};
        text-align:left;
      `;
    });

    table.querySelectorAll<HTMLElement>("td").forEach((td) => {
      const tdStyle = window.getComputedStyle(td);
      const bg = tdStyle.backgroundColor;
      td.style.cssText = `
        padding:8px 10px;border:1px solid #e2e8f0;
        color:${tdStyle.color || '#1e293b'};
        font-size:${tdStyle.fontSize || '12px'};
        ${bg && bg !== "rgba(0, 0, 0, 0)" ? `background:${bg};` : ""}
      `;

      // Preserve badge-like spans inside cells
      td.querySelectorAll<HTMLElement>("span").forEach((span) => {
        const spanStyle = window.getComputedStyle(span);
        const spanBg = spanStyle.backgroundColor;
        if (spanBg && spanBg !== "rgba(0, 0, 0, 0)" && spanBg !== "transparent") {
          span.style.cssText = `
            display:inline-block;padding:2px 8px;border-radius:4px;
            font-size:11px;font-weight:600;
            background:${spanBg};
            color:${spanStyle.color || '#1e293b'};
          `;
        }
      });
    });

    // Zebra striping
    const rows = table.querySelectorAll<HTMLElement>("tbody tr, tr");
    rows.forEach((tr, i) => {
      if (i > 0 && i % 2 === 0) {
        tr.querySelectorAll<HTMLElement>("td").forEach((td) => {
          if (!td.style.background && !td.style.backgroundColor) {
            td.style.backgroundColor = "#f8fafc";
          }
        });
      }
    });
  });
}
