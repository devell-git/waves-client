/**
 * Multi-tenant POR ORIGEM DA REQUISIÇÃO (host).
 *
 * Cada tenant declara os `hosts` que atende + a `api_url` (login/API) + a
 * `api_key` (X-API-KEY) + o branding (logos e imagem de login). O servidor
 * resolve o tenant pelo Host do request e carrega tudo a partir dele.
 *
 * A lista fica num arquivo fora do git (default `.secrets/tenants.json`),
 * apontado por `TENANTS_FILE`. Schema:
 *
 *   {
 *     "tenants": [
 *       {
 *         "tenant": "empresa-a",
 *         "hosts": ["app.empresa-a.com", "empresa-a.waves.app"],
 *         "api_url": "https://api.empresa-a.com",
 *         "api_key": "bbbl_...",
 *         "logo_white": "https://cdn/.../logo-white.png",
 *         "logo_dark":  "https://cdn/.../logo-dark.png",
 *         "img_login":  "https://cdn/.../login-bg.jpg"
 *       }
 *     ]
 *   }
 *
 * Resolução por request via AsyncLocalStorage: o middleware resolve o tenant
 * pelo Host e roda o handler dentro do contexto. Os consumidores chamam
 * `getTenantUrl()` / `getTenantKey()` sem precisar do `req`.
 *
 * Fora de um request (ou Host sem match), cai no `DEFAULT_TENANT` (env), senão
 * no primeiro tenant do arquivo, senão no legado `WAVES_URL`/`WAVES_TOKEN`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface TenantBranding {
  tenant: string;
  logo_white?: string;
  logo_dark?: string;
  img_login?: string;
  /** Base WEB do tenant (api_url sem o /api) — pro forgot-password etc. */
  web_url?: string;
  /** URL de "esqueci a senha" (override; senão derivada de web_url). */
  forgot_password_url?: string;
}

export interface Tenant {
  id: string;
  /** api_url normalizada (sem barra final). */
  url: string;
  /** X-API-KEY do tenant. */
  key: string;
  hosts: string[];
  /** Subpath onde o app é servido (ex.: "/waves-client/"); "/" se na raiz. */
  path: string;
  branding: TenantBranding;
}

interface TenantEntry {
  tenant: string;
  /** Aceita `hosts` (array) OU `host` (string única) — são unificados. */
  hosts?: string[];
  host?: string;
  /** Subpath onde o app é servido (ex.: "/waves-client/"). */
  path?: string;
  api_url: string;
  api_key?: string;
  logo_white?: string;
  logo_dark?: string;
  img_login?: string;
  forgot_password_url?: string;
}

const tenantStore = new AsyncLocalStorage<Tenant>();

// Cache do arquivo parseado, invalidado por mtime.
let _fileCache: { mtimeMs: number; tenants: Tenant[] } | null = null;

function tenantsFilePath(): string {
  const raw = process.env.TENANTS_FILE?.trim() || ".secrets/tenants.json";
  return raw.startsWith("/") ? raw : resolve(ROOT_DIR, raw);
}

function normalizeHost(host: string | undefined): string {
  let h = (host ?? "").trim().toLowerCase();
  // Aceita entradas "sujas" no tenants.json (ex.: "http://69.164.216.83/waves-client/")
  // OU header com porta ("host:3002") → extrai só o hostname.
  h = h.replace(/^https?:\/\//, ""); // remove esquema
  h = h.split("/")[0] ?? h; // remove path
  h = h.split(":")[0] ?? h; // remove porta
  return h.trim();
}

function toTenant(e: TenantEntry): Tenant {
  const url = (e.api_url ?? "").trim().replace(/\/+$/, "");
  // Base WEB = api_url sem o sufixo /api (ex.: .../api → ...).
  const webUrl = url.replace(/\/api$/i, "");
  // Unifica `hosts` (array) + `host` (string única) → lista normalizada.
  const hosts = [...(e.hosts ?? []), ...(e.host ? [e.host] : [])]
    .map((h) => normalizeHost(h))
    .filter(Boolean);
  // path normalizado: garante barras nas pontas ("/waves-client/"); raiz = "/".
  const path = e.path?.trim()
    ? `/${e.path.trim().replace(/^\/+|\/+$/g, "")}/`
    : "/";
  return {
    id: e.tenant,
    url,
    // api_key opcional → fallback pra WAVES_TOKEN (migração mono-key).
    key: (e.api_key ?? process.env.WAVES_TOKEN ?? "").trim(),
    hosts,
    path,
    branding: {
      tenant: e.tenant,
      logo_white: e.logo_white,
      logo_dark: e.logo_dark,
      img_login: e.img_login,
      web_url: webUrl || undefined,
      forgot_password_url:
        e.forgot_password_url?.trim() ||
        (webUrl ? `${webUrl}/forgot-password` : undefined),
    },
  };
}

/** Lê e parseia o tenants.json (cacheado por mtime). Vazio se não existir. */
function loadTenants(): Tenant[] {
  const p = tenantsFilePath();
  if (!existsSync(p)) return [];
  const mtimeMs = statSync(p).mtimeMs;
  if (_fileCache && _fileCache.mtimeMs === mtimeMs) return _fileCache.tenants;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    // JSON quebrado (ex.: edição manual em andamento) NÃO pode derrubar o
    // servidor — o middleware resolve tenant em todo request. Degrada gracioso:
    // mantém a última config boa (se houver), senão cai no default/legado.
    console.error(
      `[tenants] tenants.json inválido em ${p}: ${(e as Error).message} — usando última config boa.`,
    );
    return _fileCache?.tenants ?? [];
  }
  const obj = parsed as { tenants?: TenantEntry[] };
  const arr: TenantEntry[] = Array.isArray(obj?.tenants)
    ? obj.tenants
    : Array.isArray(parsed)
      ? (parsed as TenantEntry[])
      : [];
  const tenants = arr.filter((e) => e && e.tenant && e.api_url).map(toTenant);
  _fileCache = { mtimeMs, tenants };
  // Diagnóstico (só quando o arquivo é (re)carregado): ajuda a depurar em prod
  // se o tenant certo está sendo lido (host certo → branding certo).
  console.log(
    `[tenants] carregados de ${p}: ${tenants.length} → ` +
      tenants.map((t) => `${t.id}[${t.hosts.join(",") || "sem-host"}]`).join(" | "),
  );
  return tenants;
}

/** Tenant "não resolvido": host SEM match em tenants.json. Sem url/key → o proxy
 * `/api/waves` nunca alcança uma Waves (falha explícita) e `/api/tenant` responde
 * 404. "Ou encontra o tenant, ou nada" — NUNCA um default/legacy silencioso
 * servindo a Waves de outro tenant. */
export const UNRESOLVED_TENANT: Tenant = {
  id: "unresolved",
  url: "",
  key: "",
  hosts: [],
  path: "/",
  branding: { tenant: "" },
};

/** `true` se o tenant foi resolvido de verdade (tem url e não é o UNRESOLVED). */
export function isTenantResolved(t: Tenant | null | undefined): boolean {
  return !!t && t.id !== "unresolved" && !!t.url;
}

/** Resolve o tenant pelo Host do request. `null` se nenhum atender o host. */
export function resolveTenantByHost(host: string | undefined): Tenant | null {
  const h = normalizeHost(host);
  if (!h) return null;
  for (const t of loadTenants()) {
    if (t.hosts.includes(h)) return t;
  }
  return null;
}

/** Default = SÓ `DEFAULT_TENANT` (env explícito, para deploy single-tenant
 * onde o operador escolhe o tenant de propósito). Sem o env → UNRESOLVED.
 * NÃO cai mais no 1º tenant do arquivo nem no legado WAVES_URL: host sem match
 * NUNCA serve a Waves de outro tenant. */
export function getDefaultTenant(): Tenant {
  const defId = process.env.DEFAULT_TENANT?.trim();
  if (defId) {
    const t = loadTenants().find((x) => x.id === defId);
    if (t) return t;
  }
  return UNRESOLVED_TENANT;
}

/** Tenant ativo do request atual (via ALS), senão o default. */
export function getActiveTenant(): Tenant {
  return tenantStore.getStore() ?? getDefaultTenant();
}

/** Roda `fn` com o tenant fixado no contexto (usado pelo middleware). */
export function runWithTenant<T>(tenant: Tenant, fn: () => T): T {
  return tenantStore.run(tenant, fn);
}

/** URL base da API do tenant ativo (sem barra final). */
export function getTenantUrl(): string {
  return getActiveTenant().url;
}

/** X-API-KEY do tenant ativo. */
export function getTenantKey(): string {
  return getActiveTenant().key;
}

/** Branding (logos + img de login) do tenant ativo — seguro pro frontend. */
export function getTenantBranding(): TenantBranding {
  return getActiveTenant().branding;
}

/** Lista de tenants configurados (debug/admin). */
export function listTenants(): Array<{ id: string; hosts: string[]; url: string }> {
  return loadTenants().map((t) => ({ id: t.id, hosts: t.hosts, url: t.url }));
}

/** Invalida o cache do arquivo (testes). */
export function clearTenantCache(): void {
  _fileCache = null;
}
