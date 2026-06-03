"use client";

// Barra de distribuição (stacked horizontal) + legenda com contagem. Gráfico
// leve, data-driven, reusado pelos relatórios (Saúde, Pendências, Carga).
export function DistroBar({
  segs,
  label,
}: {
  segs: Array<{ v: number; cls: string; label: string }>;
  label?: string;
}) {
  const total = segs.reduce((s, x) => s + x.v, 0) || 1;
  const shown = segs.filter((s) => s.v > 0);
  return (
    <div className="border-b px-3 py-2.5">
      {label && (
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      )}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {shown.map((s, i) => (
          <div
            key={i}
            className={s.cls}
            style={{ width: `${(s.v / total) * 100}%` }}
            title={`${s.label}: ${s.v}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {segs.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className={`size-2 rounded-full ${s.cls}`} />
            {s.label} <span className="font-semibold tabular-nums text-foreground/80">{s.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Barras horizontais por categoria (ex.: carga por responsável). Cada item: um
// rótulo + barra proporcional ao total, com uma fração destacada (ex.: críticas).
export function HBars({
  items,
  max,
}: {
  items: Array<{ label: string; total: number; risk: number }>;
  max?: number;
}) {
  const m = max ?? Math.max(1, ...items.map((i) => i.total));
  return (
    <div className="space-y-1.5 border-b px-3 py-2.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-28 shrink-0 truncate text-[11px]" title={it.label}>{it.label}</div>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-muted">
            <div className="absolute inset-y-0 left-0 rounded bg-sky-500/40" style={{ width: `${(it.total / m) * 100}%` }} />
            {it.risk > 0 && (
              <div className="absolute inset-y-0 left-0 rounded bg-rose-500" style={{ width: `${(it.risk / m) * 100}%` }} title={`${it.risk} críticas`} />
            )}
          </div>
          <div className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {it.total}{it.risk > 0 ? ` · ${it.risk}🔴` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
