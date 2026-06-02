/**
 * Cliente da spec OpenUI da Waves — fonte única das 26 tools nativas.
 *
 * Fluxo:
 *   1. `loadOpenUISpec()` busca GET /api/openui/spec (cache 5min)
 *   2. `buildOpenAIToolsFromSpec()` converte → array no formato OpenAI tools
 *      (function declarations com name/description/parameters)
 *   3. `executeOpenUITool()` executa uma chamada real:
 *      - resolve path-params (`{id}` etc) com args
 *      - GET → query string
 *      - POST/PUT/DELETE → body JSON
 *      - Auth: Bearer Sanctum (do user logado) + X-API-KEY (tenant)
 *
 * Spec é pública (sem auth). Tools individuais exigem Bearer.
 */
import "dotenv/config";
import { getTenantUrl, getTenantKey } from "./tenants.js";

const OPENUI_SPEC_PATH = "/openui/spec";
const SPEC_CACHE_TTL_MS = 5 * 60 * 1000; // 5min

export interface OpenUIEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  url: string;
}

export interface OpenUIToolSchema {
  name: string;
  description: string;
  endpoint: OpenUIEndpoint;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: unknown;
}

export interface OpenUISpec {
  version: number;
  chat: { method: string; path: string; url: string; stream_protocol: string; auth: string };
  auth: Record<string, unknown>;
  tools: OpenUIToolSchema[];
  counts: { tools: number };
}

interface SpecCache {
  spec: OpenUISpec;
  loadedAt: number;
}

let _specCache: SpecCache | null = null;

function getWavesUrl(): string {
  return getTenantUrl();
}

function getWavesApiKey(): string {
  return getTenantKey();
}

export async function loadOpenUISpec(force = false): Promise<OpenUISpec> {
  const now = Date.now();
  if (
    !force &&
    _specCache &&
    now - _specCache.loadedAt < SPEC_CACHE_TTL_MS
  ) {
    return _specCache.spec;
  }
  const url = `${getWavesUrl()}${OPENUI_SPEC_PATH}`;
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-API-KEY": getWavesApiKey(),
    },
  });
  if (!r.ok) {
    throw new Error(`OpenUI spec ${r.status} em ${url}`);
  }
  const spec = (await r.json()) as OpenUISpec;
  _specCache = { spec, loadedAt: now };
  return spec;
}

/**
 * Converte uma OpenUIToolSchema → formato OpenAI tools (com executor).
 * O `function.function` é o executor real que será chamado pelo SDK quando o
 * modelo emitir tool_call.
 */
export function buildOpenAIToolsFromSpec(
  spec: OpenUISpec,
  accessToken: string,
) {
  return spec.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: (t.inputSchema?.properties as Record<string, unknown>) ?? {},
        required: t.inputSchema?.required ?? [],
      },
      function: async (args: Record<string, unknown>) => {
        const result = await executeOpenUITool(t, args ?? {}, accessToken);
        return JSON.stringify(result);
      },
      parse: JSON.parse,
    },
  }));
}

/**
 * Executa uma tool real da Waves OpenUI.
 *  - path-params (`{id}`) viram args.id (e são removidos do query/body)
 *  - GET: args → query string
 *  - POST/PUT: args → body JSON
 *  - DELETE: args → query string (no body por convenção)
 */
export async function executeOpenUITool(
  tool: OpenUIToolSchema,
  args: Record<string, unknown>,
  accessToken: string,
): Promise<unknown> {
  // 1. resolve path params
  const pathParams = [...tool.endpoint.path.matchAll(/\{([^}]+)\}/g)].map(
    (m) => m[1],
  );
  let path = tool.endpoint.path;
  const remainingArgs: Record<string, unknown> = { ...args };
  for (const p of pathParams) {
    const v = remainingArgs[p];
    if (v == null) {
      throw new Error(
        `Tool ${tool.name}: parâmetro path '${p}' obrigatório, recebido ${JSON.stringify(v)}`,
      );
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(v)));
    delete remainingArgs[p];
  }

  // 2. monta URL final + query string (GET/DELETE)
  const cfgUrl = getWavesUrl();
  // a `path` da spec já vem com /api/... mas getWavesUrl já termina em /api,
  // então só pegamos a parte após /api
  const apiPath = path.replace(/^\/api/, "");
  let url = `${cfgUrl}${apiPath}`;

  const method = tool.endpoint.method.toUpperCase();
  const sendBody = method === "POST" || method === "PUT" || method === "PATCH";

  if (!sendBody) {
    // GET/DELETE: serializa args como query string
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(remainingArgs)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) qs.append(`${k}[]`, String(item));
      } else if (typeof v === "object") {
        qs.set(k, JSON.stringify(v));
      } else {
        qs.set(k, String(v));
      }
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  // 3. headers
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-API-KEY": getWavesApiKey(),
    Authorization: `Bearer ${accessToken}`,
  };
  if (sendBody) headers["Content-Type"] = "application/json";

  // 4. fetch
  const resp = await fetch(url, {
    method,
    headers,
    body: sendBody ? JSON.stringify(remainingArgs) : undefined,
  });

  const text = await resp.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!resp.ok) {
    return {
      error: true,
      status: resp.status,
      message:
        typeof body === "object" && body !== null && "message" in body
          ? (body as { message: string }).message
          : `HTTP ${resp.status}`,
      details: body,
    };
  }
  return body;
}
