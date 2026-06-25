// Cliente do Architecture Explorer (#849). Bate no proxy admin-only
// GET /api/architecture/graph (server/index.ts → hermes-graph-api :18820, #848).
// Desacoplamento §1: o front fala SÓ HTTP; quem lê o FS do Hermes é o scanner
// (#788) do lado do Hermes. Aqui só consumimos o registry.json já pronto.

/** Tipos de nó conhecidos do scanner (#788). String aberta p/ tolerar tipos novos. */
export type ArchNodeKind =
  | "tenant"
  | "profile"
  | "mcp"
  | "skill"
  | "plugin"
  | "worker"
  | "patch";

export interface ArchGraphNode {
  id: string;
  type: ArchNodeKind | string;
  label: string;
  data?: Record<string, unknown>;
}

export interface ArchGraphEdge {
  source: string;
  target: string;
  /** mounts (profile→mcp) · uses (profile→skill) · loads (profile→plugin) · runs (worker→profile) */
  type: string;
}

export interface ArchGraph {
  generated_at: string | null;
  counts: Record<string, number>;
  nodes: ArchGraphNode[];
  edges: ArchGraphEdge[];
}

/**
 * Busca o grafo de arquitetura. Bearer do usuário no header (o proxy do server
 * deriva admin do token via isAdminFromBearer — nunca confia em query param).
 * `refresh` força um re-scan no lado do Hermes antes de servir.
 */
export async function fetchArchitectureGraph(
  accessToken: string,
  refresh = false,
): Promise<ArchGraph> {
  const res = await fetch(`/api/architecture/graph${refresh ? "?refresh=1" : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (res.status === 403) {
    throw new Error("Apenas administradores podem ver os grafos.");
  }
  if (!res.ok) {
    let msg = `Falha ao carregar o grafo (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body?.error) msg = String(body.error);
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ArchGraph;
}
