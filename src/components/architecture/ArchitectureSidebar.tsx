// Sidebar de detalhes do Architecture Explorer (#850). Mostra os dados do node
// selecionado (model/channels/plugins/hosts/path/metrics…) e suas RELAÇÕES
// (mounts/uses/loads/runs), cada uma clicável p/ navegar até o node vizinho.
import type { ArchGraph, ArchGraphNode } from "../../api/architecture";
import { ARCH_TYPE_COLOR } from "./nodes";
import type { ActivityEvent } from "./useActivityStream";

const KIND_LABEL: Record<string, string> = {
  tenant: "Tenant",
  profile: "Profile",
  mcp: "MCP",
  skill: "Skill",
  plugin: "Plugin",
  worker: "Worker",
  patch: "Patch",
};

const EDGE_LABEL: Record<string, string> = {
  mounts: "monta MCP",
  uses: "usa skill",
  loads: "carrega plugin",
  runs: "roda",
  delegates_to: "delega a",
};

function fmtValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface Relation {
  node: ArchGraphNode;
  type: string;
  dir: "out" | "in";
}

/** Arestas do node, dos dois lados (saída = depende de; entrada = é usado por). */
export function relationsOf(graph: ArchGraph, id: string): Relation[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const rels: Relation[] = [];
  for (const e of graph.edges) {
    if (e.source === id) {
      const n = byId.get(e.target);
      if (n) rels.push({ node: n, type: e.type, dir: "out" });
    } else if (e.target === id) {
      const n = byId.get(e.source);
      if (n) rels.push({ node: n, type: e.type, dir: "in" });
    }
  }
  return rels.sort((a, b) => a.node.label.localeCompare(b.node.label, "pt-BR"));
}

interface Props {
  node: ArchGraphNode | null;
  graph: ArchGraph;
  onClose: () => void;
  onSelect: (id: string) => void;
  recentCalls?: ActivityEvent[];
}

export function ArchitectureSidebar({ node, graph, onClose, onSelect, recentCalls = [] }: Props) {
  if (!node) return null;
  const color = ARCH_TYPE_COLOR[node.type] ?? "#94a3b8";
  const rels = relationsOf(graph, node.id);
  const data = node.data ?? {};
  const dataEntries = Object.entries(data);

  return (
    <aside className="arch-sidebar" aria-label="Detalhes do node">
      <div className="arch-sidebar-head" style={{ borderTopColor: color }}>
        <div className="arch-sidebar-headinfo">
          <span className="arch-sidebar-kind" style={{ color }}>
            {KIND_LABEL[node.type] ?? node.type}
          </span>
          <h2 className="arch-sidebar-title">{node.label}</h2>
        </div>
        <button
          type="button"
          className="arch-sidebar-close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
      </div>

      {dataEntries.length > 0 && (
        <div className="arch-sidebar-section">
          <h3>Detalhes</h3>
          <dl className="arch-sidebar-data">
            {dataEntries
              .filter(([k]) => !["tools", "sub_skills"].includes(k))
              .map(([k, v]) => (
                <div key={k} className="arch-sidebar-datarow">
                  <dt>{k}</dt>
                  <dd>{fmtValue(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      {/* MCP Tools (expandível) */}
      {Array.isArray(data.tools) && data.tools.length > 0 && (
        <div className="arch-sidebar-section">
          <details>
            <summary className="arch-sidebar-expandable">
              <h3>Tools ({(data.tools as string[]).length})</h3>
            </summary>
            <ul className="arch-sidebar-list">
              {(data.tools as string[]).map((t) => (
                <li key={t} className="arch-sidebar-list-item">{t}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Sub-agent skills (expandível) */}
      {Array.isArray(data.sub_agent_skills) && data.sub_agent_skills.length > 0 && (
        <div className="arch-sidebar-section">
          <details>
            <summary className="arch-sidebar-expandable">
              <h3>Sub-agentes ({(data.sub_agent_skills as string[]).length})</h3>
            </summary>
            <ul className="arch-sidebar-list">
              {(data.sub_agent_skills as string[]).map((s) => (
                <li key={s} className="arch-sidebar-list-item arch-sidebar-list-item--agent">{s}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Sub-skills (expandível) */}
      {Array.isArray(data.sub_skills) && data.sub_skills.length > 0 && (
        <div className="arch-sidebar-section">
          <details>
            <summary className="arch-sidebar-expandable">
              <h3>Sub-skills ({(data.sub_skills as string[]).length})</h3>
            </summary>
            <ul className="arch-sidebar-list">
              {(data.sub_skills as string[]).map((s) => (
                <li key={s} className="arch-sidebar-list-item">{s}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Sub-agentes (delegates_to) */}
      {Array.isArray(data.sub_agents) && data.sub_agents.length > 0 && (
        <div className="arch-sidebar-section">
          <h3>Delega a ({(data.sub_agents as string[]).length} sub-agentes)</h3>
          <ul className="arch-sidebar-list">
            {(data.sub_agents as string[]).map((agent) => {
              const agentNode = graph.nodes.find((n) => n.label === agent);
              const agentEdges = agentNode
                ? graph.edges.filter((e) => e.source === agentNode.id)
                : [];
              const mcpCount = agentEdges.filter((e) => e.type === "mounts").length;
              const skillCount = agentEdges.filter((e) => e.type === "uses").length;
              return (
                <li key={agent}>
                  <button
                    type="button"
                    className="arch-rel"
                    onClick={() => onSelect(agentNode?.id ?? "")}
                    title={`Ver ${agent}`}
                  >
                    <span className="arch-rel-dot" style={{ background: ARCH_TYPE_COLOR.profile }} />
                    <span className="arch-rel-label">{agent}</span>
                    <span className="arch-rel-type">{mcpCount} MCPs · {skillCount} skills</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {recentCalls.length > 0 && (
        <div className="arch-sidebar-section">
          <h3>Atividade recente ({recentCalls.length})</h3>
          <ul className="arch-sidebar-activity">
            {recentCalls
              .slice()
              .reverse()
              .slice(0, 10)
              .map((ev, i) => (
                <li key={`${ev.ts}-${i}`} className="arch-activity-item">
                  <span className="arch-activity-dot" aria-hidden="true">
                    {ev.event === "tool_call" ? "→" : "←"}
                  </span>
                  <span className="arch-activity-tool">{ev.tool}</span>
                  <span className="arch-activity-ts">
                    {new Date(ev.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="arch-sidebar-section">
        <h3>Relações ({rels.length})</h3>
        {rels.length === 0 ? (
          <p className="arch-sidebar-empty">Sem dependências mapeadas.</p>
        ) : (
          <ul className="arch-sidebar-rels">
            {rels.map((r, i) => (
              <li key={`${r.dir}-${r.node.id}-${i}`}>
                <button
                  type="button"
                  className="arch-rel"
                  onClick={() => onSelect(r.node.id)}
                  title={`Ir para ${r.node.label}`}
                >
                  <span className="arch-rel-dir" aria-hidden="true">
                    {r.dir === "out" ? "→" : "←"}
                  </span>
                  <span
                    className="arch-rel-dot"
                    style={{ background: ARCH_TYPE_COLOR[r.node.type] ?? "#94a3b8" }}
                  />
                  <span className="arch-rel-label">{r.node.label}</span>
                  <span className="arch-rel-type">{EDGE_LABEL[r.type] ?? r.type}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
