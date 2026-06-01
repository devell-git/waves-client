/**
 * toolProvider GENÉRICO pro runtime OpenUI (fluxo EXECUTE — sem LLM).
 *
 * Lê `/api/openui/spec` (29 tools nativas da Waves) e monta um map
 * `{ tool_name: async(args) => result }` que o `<Renderer toolProvider>` usa
 * pra resolver `Query()`/`Mutation()` — chamando o endpoint de cada tool direto
 * na Waves (via o proxy `/api/waves/*`, que injeta o X-API-KEY e repassa o
 * Bearer do usuário). É dirigido pela SPEC, então vale pra QUALQUER cliente/
 * tenant — nada hardcoded.
 *
 * Resultados são cacheados por (tool, args) com TTL curto → "dados já em cache":
 * o kanban carrega uma vez e listar/filtrar reaproveita sem novo fetch.
 */
import { loadSession } from "./session";

interface SpecToolEndpoint {
  method: string;
  path: string; // ex.: /api/openui/tools/workflows/kanban
}
interface SpecTool {
  name: string;
  endpoint?: SpecToolEndpoint;
}
interface OpenUISpec {
  tools?: SpecTool[];
}

export type ToolProvider = Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
>;

const RESULT_TTL_MS = 60_000;
const resultCache = new Map<string, { at: number; data: unknown }>();

function authHeaders(): Record<string, string> {
  const s = loadSession();
  return s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {};
}

async function callTool(
  tool: SpecTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ep = tool.endpoint!;
  const key = `${tool.name}:${JSON.stringify(args ?? {})}`;
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.data;

  // /api/openui/tools/... → /api/waves/openui/tools/... (o proxy tira o /api).
  const path = ep.path.replace(/^\/api/, "");
  let url = `/api/waves${path}`;
  const init: RequestInit = { method: ep.method, headers: { ...authHeaders() } };

  if (ep.method.toUpperCase() === "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args ?? {})) {
      if (v != null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  } else {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(args ?? {});
  }

  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      (data as { message?: string })?.message || `Tool ${tool.name}: HTTP ${r.status}`,
    );
  }
  resultCache.set(key, { at: Date.now(), data });
  return data;
}

let providerCache: ToolProvider | null = null;
let loading: Promise<ToolProvider> | null = null;

async function build(): Promise<ToolProvider> {
  const r = await fetch("/api/openui/spec");
  const spec = (await r.json()) as OpenUISpec;
  const map: ToolProvider = {};
  for (const tool of spec.tools ?? []) {
    if (!tool.endpoint) continue;
    map[tool.name] = (args) => callTool(tool, args ?? {});
  }
  return map;
}

/** Garante o toolProvider montado (idempotente). Chame no mount do ChatPage. */
export async function ensureToolProvider(): Promise<ToolProvider> {
  if (providerCache) return providerCache;
  if (!loading) {
    loading = build()
      .then((m) => {
        providerCache = m;
        return m;
      })
      .catch((e) => {
        loading = null; // permite retry
        throw e;
      });
  }
  return loading;
}

/** O toolProvider já montado (ou null se ainda carregando). */
export function getToolProvider(): ToolProvider | null {
  return providerCache;
}

/** Limpa o cache de resultados (ex.: após uma mutação que muda dados). */
export function clearToolResultCache(): void {
  resultCache.clear();
}
