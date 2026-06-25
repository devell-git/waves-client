// Custom node do Architecture Explorer (#849): um único componente que se
// estiliza pelo TIPO (profile/skill/mcp/worker/patch/tenant/plugin). Handles
// nas laterais (esquerda=target, direita=source) pra casar com o layout
// esquerda→direita do layout.ts.
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

/** Métricas operacionais que o scanner #788 coleta (queue db + circuit-breakers.json). */
export type ArchMetrics = {
  queue?: Record<string, number>;
  circuit?: string;
};

export type ArchNodeData = {
  kind: string;
  label: string;
  meta?: Record<string, unknown>;
  metrics?: ArchMetrics;
  /** true quando o profile tem atividade recente (SSE) — node pulsa */
  active?: boolean;
};

export type ArchFlowNode = Node<ArchNodeData, "arch">;

/** Rótulo curto pros status de fila conhecidos (cai no próprio status se novo). */
const QUEUE_LABEL: Record<string, string> = {
  done: "ok",
  processing: "proc",
  pending: "fila",
  failed: "falha",
  dlq: "dlq",
  retry: "retry",
};

const META: Record<string, { icon: string; cls: string; label: string }> = {
  tenant: { icon: "🏢", cls: "tenant", label: "Tenant" },
  profile: { icon: "🤖", cls: "profile", label: "Profile" },
  mcp: { icon: "🔌", cls: "mcp", label: "MCP" },
  skill: { icon: "📚", cls: "skill", label: "Skill" },
  plugin: { icon: "🧩", cls: "plugin", label: "Plugin" },
  worker: { icon: "⚙️", cls: "worker", label: "Worker" },
  patch: { icon: "🩹", cls: "patch", label: "Patch" },
};

export function ArchNode({ data, selected }: NodeProps<ArchFlowNode>) {
  const m = META[data.kind] ?? { icon: "•", cls: "other", label: data.kind };
  const metrics = data.metrics;
  const queueEntries = metrics?.queue ? Object.entries(metrics.queue) : [];
  const hasMetrics = Boolean(metrics?.circuit) || queueEntries.length > 0;

  return (
    <div
      className={`arch-node arch-node--${m.cls}${selected ? " arch-node--selected" : ""}${data.active ? " arch-node--active" : ""}`}
      title={`${m.label}: ${data.label}`}
    >
      <Handle type="target" position={Position.Left} className="arch-handle" />
      <span className="arch-node-icon" aria-hidden="true">
        {m.icon}
      </span>
      <span className="arch-node-body">
        <span className="arch-node-label">{data.label}</span>
        <span className="arch-node-kind">{m.label}</span>
        {hasMetrics && (
          <span className="arch-node-metrics">
            {metrics?.circuit && (
              <span
                className={`arch-circuit arch-circuit--${metrics.circuit}`}
                title={`Circuit breaker: ${metrics.circuit}`}
              >
                {metrics.circuit}
              </span>
            )}
            {queueEntries.map(([k, v]) => (
              <span key={k} className="arch-q" title={`fila: ${k} = ${v}`}>
                {QUEUE_LABEL[k] ?? k} {v}
              </span>
            ))}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Right} className="arch-handle" />
    </div>
  );
}

/** Cores por tipo (minimap + legenda + chip do node). Fonte única de verdade. */
export const ARCH_TYPE_COLOR: Record<string, string> = {
  tenant: "#8b5cf6",
  profile: "#2563eb",
  mcp: "#0891b2",
  skill: "#16a34a",
  plugin: "#d97706",
  worker: "#dc2626",
  patch: "#64748b",
};

export const archNodeTypes = { arch: ArchNode };
