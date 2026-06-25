// Layout hierárquico determinístico por TIPO — sem dependência de dagre/elk.
// Cada tipo ocupa uma coluna; os nós empilham na vertical (ordenados por label).
// O fluxo das arestas é majoritariamente esquerda→direita:
//   worker → profile → (mcp | skill | plugin)   ·   tenant e patch isolados.
// React Flow cuida de zoom/pan/minimap; o MVP (#849) só precisa de posições
// estáveis e legíveis. Interações/filtros ricos ficam pra #850.
import type { ArchGraph } from "../../api/architecture";

/** Ordem das colunas (da esquerda pra direita). Tipos fora da lista vão pro fim. */
const COLUMN_ORDER = ["tenant", "worker", "profile", "mcp", "skill", "plugin", "patch"];

const COL_GAP = 320; // distância horizontal entre colunas
const ROW_GAP = 72; // distância vertical entre nós da mesma coluna
const COL_TOP = 40; // respiro no topo de cada coluna

export interface Pos {
  x: number;
  y: number;
}

/** Mapa id→{x,y}. Determinístico (mesma entrada → mesmas posições). */
export function layoutByType(graph: ArchGraph): Map<string, Pos> {
  const byType = new Map<string, { id: string; label: string }[]>();
  for (const n of graph.nodes) {
    const arr = byType.get(n.type) ?? [];
    arr.push({ id: n.id, label: n.label ?? n.id });
    byType.set(n.type, arr);
  }

  // Ordem das colunas: conhecidas primeiro (COLUMN_ORDER), depois quaisquer extras.
  const known = COLUMN_ORDER.filter((t) => byType.has(t));
  const extras = [...byType.keys()].filter((t) => !COLUMN_ORDER.includes(t)).sort();
  const columns = [...known, ...extras];

  const pos = new Map<string, Pos>();
  columns.forEach((type, colIdx) => {
    const nodes = (byType.get(type) ?? []).slice().sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
    nodes.forEach((node, rowIdx) => {
      pos.set(node.id, { x: colIdx * COL_GAP, y: COL_TOP + rowIdx * ROW_GAP });
    });
  });
  return pos;
}
