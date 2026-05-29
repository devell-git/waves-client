/**
 * Cliente frontend da spec OpenUI da Waves.
 *
 * Server (Express) já cacheia a spec — frontend só faz fetch local.
 * Tipos espelhados de `server/openui-spec.ts` pra evitar import cross-tier.
 */

export interface OpenUIEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  url: string;
}

export interface OpenUIInputProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: OpenUIInputProperty;
  format?: string;
  default?: unknown;
}

export interface OpenUITool {
  name: string;
  description: string;
  endpoint: OpenUIEndpoint;
  inputSchema: {
    type: "object";
    properties?: Record<string, OpenUIInputProperty>;
    required?: string[];
  };
  outputSchema?: unknown;
}

export interface OpenUISpec {
  version: number;
  chat: {
    method: string;
    path: string;
    url: string;
    stream_protocol: string;
    auth: string;
  };
  auth: Record<string, unknown>;
  tools: OpenUITool[];
  counts: { tools: number };
}

export async function fetchOpenUISpec(): Promise<OpenUISpec | null> {
  try {
    const r = await fetch("/api/openui/spec");
    if (!r.ok) return null;
    return (await r.json()) as OpenUISpec;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agrupamento de tools por categoria — derivado do path REST
// ---------------------------------------------------------------------------

export interface ToolGroup {
  category: string;
  label: string;
  tools: OpenUITool[];
}

const CATEGORY_LABELS: Record<string, string> = {
  forms: "Formulários",
  workflows: "Workflows",
  tasks: "Tarefas",
  boards: "Boards",
  other: "Outros",
};

function inferCategory(tool: OpenUITool): string {
  // path típico: /api/openui/tools/<categoria>/<...>
  const m = tool.endpoint.path.match(/\/api\/openui\/tools\/([^/]+)/);
  if (!m) return "other";
  const head = m[1];
  // tarefas estão em /tasks ou /tasks/{id}
  if (head === "forms") return "forms";
  if (head === "workflows") return "workflows";
  if (head === "tasks") return "tasks";
  if (head === "boards") return "boards";
  return "other";
}

export function buildToolGroups(spec: OpenUISpec): ToolGroup[] {
  const map = new Map<string, OpenUITool[]>();
  for (const t of spec.tools) {
    const cat = inferCategory(t);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(t);
  }
  const order = ["workflows", "tasks", "boards", "forms", "other"];
  const groups: ToolGroup[] = [];
  for (const cat of order) {
    if (!map.has(cat)) continue;
    groups.push({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      tools: map.get(cat)!.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Build de prompt natural pro Steve quando o user dispara uma tool via UI
// ---------------------------------------------------------------------------

export function buildPromptForTool(
  tool: OpenUITool,
  params: Record<string, unknown>,
): string {
  const hasParams = Object.keys(params).length > 0;
  const paramsBlock = hasParams
    ? `\n\nParâmetros:\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\``
    : "";
  return (
    `Use a tool \`${tool.name}\` da Waves OpenUI ` +
    `(${tool.endpoint.method} ${tool.endpoint.path}) ` +
    `para buscar/executar o que se pede a seguir.${paramsBlock}\n\n` +
    `Retorne o resultado em openui-lang (Card + componentes apropriados) com FollowUpBlock.`
  );
}

// ---------------------------------------------------------------------------
// Filtro/busca de tools (case-insensitive em name + description)
// ---------------------------------------------------------------------------

export function filterTools(tools: OpenUITool[], query: string): OpenUITool[] {
  if (!query.trim()) return tools;
  const q = query.toLowerCase();
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q),
  );
}
