import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

config({
  path: resolve(rootDir, ".env"),
  override: true,
});

export function maskSecret(value: string | undefined): string {
  if (!value) return "(não definida)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

export function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function getOpenAiProvider(): "codex" | "openai" | "hermes" {
  const p = (process.env.OPENAI_PROVIDER || "").trim().toLowerCase();
  if (p === "codex") return "codex";
  if (p === "hermes") return "hermes";
  return "openai";
}

/**
 * Token Bearer do api_server do Hermes (profile hermes-bioshield-steve).
 * Lê primeiro de HERMES_API_KEY, depois do arquivo .secrets/hermes-steve.key
 * (gerado pelo setup do api_server). Lança se faltar.
 */
export function getHermesApiKey(): string {
  const envKey = process.env.HERMES_API_KEY?.trim();
  if (envKey) return envKey;
  const raw = process.env.HERMES_KEY_PATH?.trim() ?? ".secrets/hermes-steve.key";
  // Path relativo é resolvido contra rootDir do projeto (não CWD do processo)
  const keyPath = raw.startsWith("/") ? raw : resolve(rootDir, raw);
  try {
    const k = readFileSync(keyPath, "utf-8").trim();
    if (!k) throw new Error("vazio");
    return k;
  } catch {
    throw new Error(
      `HERMES_API_KEY não configurada e ${keyPath} não acessível. ` +
        "Defina HERMES_API_KEY no .env ou crie o arquivo da key.",
    );
  }
}

export function getHermesBaseUrl(): string {
  return (
    process.env.HERMES_BASE_URL?.trim() || "http://127.0.0.1:18860/v1"
  );
}

interface CodexAuth {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  auth_mode?: string;
}

const CODEX_AUTH_PATH =
  process.env.CODEX_AUTH_PATH || resolve(homedir(), ".codex", "auth.json");

const CODEX_CACHE_TTL_MS = 5 * 60 * 1000;
let _codexCache: { token: string; loadedAt: number } | null = null;

export function getCodexAccessToken(): string {
  const now = Date.now();
  if (_codexCache && now - _codexCache.loadedAt < CODEX_CACHE_TTL_MS) {
    return _codexCache.token;
  }
  let raw: string;
  try {
    raw = readFileSync(CODEX_AUTH_PATH, "utf-8");
  } catch {
    throw new Error(
      `Codex auth file não encontrado em ${CODEX_AUTH_PATH}. ` +
        "Rode `codex auth login` ou ajuste CODEX_AUTH_PATH no .env.",
    );
  }
  let parsed: CodexAuth;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Codex auth file inválido (JSON malformado): ${CODEX_AUTH_PATH}`);
  }
  const token = parsed.tokens?.access_token?.trim();
  if (!token) {
    throw new Error(
      `Codex auth file sem tokens.access_token: ${CODEX_AUTH_PATH}. ` +
        "Refresh pode estar pendente — cheque tail /home/bot/shared-scripts/refresh-codex-oauth.log.",
    );
  }
  _codexCache = { token, loadedAt: now };
  return token;
}

export function invalidateCodexCache(): void {
  _codexCache = null;
}

export function getOpenAiCredential(): string {
  const p = getOpenAiProvider();
  if (p === "codex") return getCodexAccessToken();
  if (p === "hermes") return getHermesApiKey();
  const k = getOpenAiKey();
  if (!k) throw new Error("OPENAI_API_KEY não configurada.");
  return k;
}

export function getOpenAiBaseUrl(): string | undefined {
  if (process.env.OPENAI_BASE_URL?.trim()) {
    return process.env.OPENAI_BASE_URL.trim();
  }
  const p = getOpenAiProvider();
  if (p === "codex") return "https://chatgpt.com/backend-api/codex";
  if (p === "hermes") return getHermesBaseUrl();
  return undefined;
}
