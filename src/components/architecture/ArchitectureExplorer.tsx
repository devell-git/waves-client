// Architecture Explorer — grafo MVP (#849) + interações (#850).
// Tela admin-only que renderiza o grafo de dependências do Hermes (profiles,
// MCPs, skills, plugins, workers, patches, tenants) com React Flow, consumindo
// o endpoint #848. #850 adiciona: sidebar de detalhes ao clicar, filtros por
// tipo (legenda interativa) e busca que centraliza/destaca o node.
// Métricas em tempo real nos nodes → #851.
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./architecture.css";
import type { AuthSession } from "../../types/auth";
import {
  fetchArchitectureGraph,
  type ArchGraph,
  type ArchGraphNode,
} from "../../api/architecture";
import { ARCH_TYPE_COLOR, archNodeTypes, type ArchFlowNode, type ArchMetrics } from "./nodes";
import { layoutByType, type Pos } from "./layout";
import { ArchitectureSidebar } from "./ArchitectureSidebar";
import { useActivityStream } from "./useActivityStream";

// QueryClient próprio desta tela — não toca o root do app (App.tsx fica intacto).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const TYPE_ORDER = ["tenant", "profile", "mcp", "skill", "plugin", "worker", "patch"];
const KIND_LABEL: Record<string, string> = {
  tenant: "Tenant",
  profile: "Profile",
  mcp: "MCP",
  skill: "Skill",
  plugin: "Plugin",
  worker: "Worker",
  patch: "Patch",
};
const NODE_W = 188;
const NODE_H = 48;
// Intervalo do modo "ao vivo": cada tick re-escaneia o estado dos workers
// (queue db + circuit-breakers) no lado do Hermes via ?refresh=1. 15s equilibra
// frescor x custo do re-scan (subprocesso). Default OFF.
const LIVE_INTERVAL_MS = 15_000;

interface FlowBase {
  nodes: ArchFlowNode[];
  edges: Edge[];
  kindById: Map<string, string>;
  posById: Map<string, Pos>;
  nodeById: Map<string, ArchGraphNode>;
}

/** registry.json → estrutura-base (posições + lookups). Recalculada só quando o
 *  grafo muda; filtro/seleção são derivados disso sem refazer o layout. */
function buildBase(graph: ArchGraph): FlowBase {
  const pos = layoutByType(graph);
  const kindById = new Map<string, string>();
  const nodeById = new Map<string, ArchGraphNode>();
  const nodes: ArchFlowNode[] = graph.nodes.map((n) => {
    kindById.set(n.id, String(n.type));
    nodeById.set(n.id, n);
    return {
      id: n.id,
      type: "arch",
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        kind: String(n.type),
        label: n.label,
        meta: n.data,
        metrics: n.data?.metrics as ArchMetrics | undefined,
      },
    };
  });

  const ids = new Set(graph.nodes.map((n) => n.id));
  const edges: Edge[] = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({
      id: `e${i}:${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      className: `arch-edge arch-edge--${e.type}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));

  return { nodes, edges, kindById, posById: pos, nodeById };
}

function ExplorerInner({ session }: { session: AuthSession }) {
  const navigate = useNavigate();
  const { setCenter } = useReactFlow();
  const [live, setLive] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["architecture-graph", live],
    queryFn: () => fetchArchitectureGraph(session.accessToken, live),
    refetchInterval: live ? LIVE_INTERVAL_MS : false,
  });

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchMsg, setSearchMsg] = useState("");

  // SSE — atividade em tempo real dos agentes
  const { activeProfiles, recentCalls, lastGraphUpdate, connected } = useActivityStream(
    session.accessToken,
    live,
  );

  // Refetch graph quando o SSE sinaliza mudança estrutural
  const prevGraphTs = useMemo(() => data?.generated_at, [data]);
  if (lastGraphUpdate && lastGraphUpdate.generated_at !== prevGraphTs) {
    refetch();
  }

  const base = useMemo(() => (data ? buildBase(data) : null), [data]);

  // Nós/arestas derivados: aplica filtro (hidden) e seleção sem refazer o layout.
  const flowNodes = useMemo<ArchFlowNode[]>(() => {
    if (!base) return [];
    return base.nodes.map((n) => ({
      ...n,
      hidden: hidden.has(n.data.kind),
      selected: n.id === selectedId,
      data: {
        ...n.data,
        active: activeProfiles.has(n.id),
      },
    }));
  }, [base, hidden, selectedId, activeProfiles]);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!base) return [];
    return base.edges.map((e) => {
      const srcHidden = hidden.has(base.kindById.get(e.source) ?? "");
      const tgtHidden = hidden.has(base.kindById.get(e.target) ?? "");
      const active = e.source === selectedId || e.target === selectedId;
      return {
        ...e,
        hidden: srcHidden || tgtHidden,
        className: `arch-edge arch-edge--${(e.className ?? "").split("arch-edge--")[1] ?? ""}${active ? " arch-edge--active" : ""}`,
      };
    });
  }, [base, hidden, selectedId]);

  const centerOn = useCallback(
    (id: string) => {
      const p = base?.posById.get(id);
      if (p) setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: 1.3, duration: 500 });
    },
    [base, setCenter],
  );

  const selectOnly = useCallback((id: string) => setSelectedId(id), []);
  const focus = useCallback(
    (id: string) => {
      setSelectedId(id);
      centerOn(id);
    },
    [centerOn],
  );

  const toggleType = useCallback((type: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const runSearch = useCallback(() => {
    const q = search.trim().toLowerCase();
    if (!q || !base) return;
    const match = base.nodes.find(
      (n) => !hidden.has(n.data.kind) && n.data.label.toLowerCase().includes(q),
    );
    if (match) {
      setSearchMsg("");
      focus(match.id);
    } else {
      setSearchMsg("Nenhum node encontrado.");
    }
  }, [search, base, hidden, focus]);

  const selectedNode = selectedId && base ? base.nodeById.get(selectedId) ?? null : null;
  const counts = data?.counts ?? {};
  const typesPresent = TYPE_ORDER.filter((t) => (counts[t] ?? 0) > 0).concat(
    Object.keys(counts).filter((t) => !TYPE_ORDER.includes(t)),
  );
  const generatedAt = data?.generated_at ? new Date(data.generated_at) : null;

  return (
    <div className="arch-explorer">
      <header className="arch-header">
        <button
          type="button"
          className="arch-back"
          onClick={() => navigate("/chat")}
          aria-label="Voltar ao chat"
        >
          ← Voltar
        </button>
        <h1 className="arch-title">Architecture Explorer</h1>
        <div className="arch-header-meta">
          {data && (
            <span className="arch-counts">
              {data.nodes.length} nós · {data.edges.length} arestas
            </span>
          )}
          {generatedAt && (
            <span className="arch-generated" title="Gerado em">
              · {generatedAt.toLocaleString("pt-BR")}
            </span>
          )}
          <button
            type="button"
            className={`arch-live${live ? " arch-live--on" : ""}`}
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
            title={
              live
                ? `Ao vivo (re-scan a cada ${LIVE_INTERVAL_MS / 1000}s) — clique p/ parar`
                : "Ligar atualização automática das métricas"
            }
          >
            <span className="arch-live-dot" aria-hidden="true" />
            {live ? (connected ? "Ao vivo" : "Conectando…") : "Ao vivo: off"}
          </button>
          <button
            type="button"
            className="arch-refresh"
            disabled={isFetching}
            onClick={() => refetch()}
          >
            {isFetching ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </header>

      <div className="arch-body">
        <div className="arch-canvas">
          {isLoading && <div className="arch-state">Carregando grafo…</div>}
          {error && (
            <div className="arch-state arch-state--error">{(error as Error).message}</div>
          )}
          {!isLoading && !error && (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={archNodeTypes}
              fitView
              minZoom={0.1}
              nodesConnectable={false}
              nodesDraggable
              elementsSelectable
              onNodeClick={(_, node) => selectOnly(node.id)}
              onPaneClick={() => setSelectedId(null)}
            >
              <Background gap={24} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n: Node) =>
                  ARCH_TYPE_COLOR[String((n.data as { kind?: string })?.kind)] ?? "#94a3b8"
                }
              />
              <Controls />

              {/* Filtros = legenda interativa (#850) */}
              <Panel position="top-left">
                <div className="arch-filters" aria-label="Filtros por tipo">
                  {typesPresent.map((t) => {
                    const off = hidden.has(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`arch-filter${off ? " arch-filter--off" : ""}`}
                        onClick={() => toggleType(t)}
                        aria-pressed={!off}
                        title={off ? "Mostrar" : "Esconder"}
                      >
                        <span
                          className="arch-legend-dot"
                          style={{ background: ARCH_TYPE_COLOR[t] ?? "#94a3b8" }}
                        />
                        {KIND_LABEL[t] ?? t}
                        <span className="arch-filter-count">{counts[t]}</span>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              {/* Busca (#850) */}
              <Panel position="top-right">
                <div className="arch-search">
                  <input
                    type="search"
                    placeholder="Buscar node…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSearchMsg("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") runSearch();
                    }}
                    aria-label="Buscar node"
                  />
                  <button type="button" onClick={runSearch} aria-label="Buscar">
                    🔍
                  </button>
                  {searchMsg && <span className="arch-search-msg">{searchMsg}</span>}
                </div>
              </Panel>
            </ReactFlow>
          )}
        </div>

        {data && (
          <ArchitectureSidebar
            node={selectedNode}
            graph={data}
            onClose={() => setSelectedId(null)}
            onSelect={focus}
            recentCalls={selectedNode ? recentCalls.get(selectedNode.id) ?? [] : []}
          />
        )}
      </div>
    </div>
  );
}

/** Entry-point: provê QueryClient (local) + ReactFlowProvider (p/ setCenter). */
export function ArchitectureExplorer({ session }: { session: AuthSession }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        <ExplorerInner session={session} />
      </ReactFlowProvider>
    </QueryClientProvider>
  );
}
