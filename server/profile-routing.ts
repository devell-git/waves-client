/**
 * Roteamento por profile Hermes.
 *
 * O waves_client suporta múltiplos profiles do Hermes ao mesmo tempo (cada
 * um num gateway/porta diferente). O frontend manda `profile` no body de
 * `/api/chat` e este módulo resolve qual `baseURL` + `apiKey` usar.
 *
 * Lista fixa por enquanto (negative-media + map). Quando virar dinâmico:
 * trocar PROFILE_REGISTRY por leitura de /home/bot/.hermes/profiles/*\/.env.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface ProfileGateway {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string;
  /** Path absoluto pro SOUL.md do profile (usado por form-cache pra invalidação por mtime). */
  soulPath: string;
}

const HERMES_HOME = resolve(homedir(), ".hermes");

interface ProfileSpec {
  id: string;
  label: string;
  port: number;
}

const PROFILE_REGISTRY: ProfileSpec[] = [
  { id: "ybrax-negative-media", label: "Mídias Negativas", port: 18862 },
  { id: "ybrax-verifique", label: "Verifique", port: 18864 },
  { id: "bioshield-steve", label: "Steve", port: 18860 },
  { id: "waves-cfo", label: "CFO", port: 18866 },
];

export const DEFAULT_PROFILE_ID = "ybrax-negative-media";

/**
 * Lê `API_SERVER_KEY` do `.env` do profile. Erra alto se não achar — sem chave
 * o gateway recusa qualquer request.
 */
function readProfileApiKey(profileId: string): string {
  const envPath = resolve(HERMES_HOME, "profiles", profileId, ".env");
  if (!existsSync(envPath)) {
    throw new Error(`Profile .env não encontrado: ${envPath}`);
  }
  const content = readFileSync(envPath, "utf-8");
  const m = content.match(/^\s*API_SERVER_KEY\s*=\s*(.+?)\s*$/m);
  if (!m) {
    throw new Error(`API_SERVER_KEY ausente em ${envPath}`);
  }
  return m[1]!.replace(/^["']|["']$/g, "");
}

const cache = new Map<string, ProfileGateway>();

export function getProfileGateway(profileId: string | undefined): ProfileGateway {
  const resolvedId =
    profileId && PROFILE_REGISTRY.some((p) => p.id === profileId)
      ? profileId
      : DEFAULT_PROFILE_ID;

  const cached = cache.get(resolvedId);
  if (cached) return cached;

  const spec = PROFILE_REGISTRY.find((p) => p.id === resolvedId)!;
  const baseURL = `http://127.0.0.1:${spec.port}/v1`;
  const apiKey = readProfileApiKey(resolvedId);
  const soulPath = resolve(HERMES_HOME, "profiles", resolvedId, "SOUL.md");

  const gw: ProfileGateway = {
    id: resolvedId,
    label: spec.label,
    baseURL,
    apiKey,
    soulPath,
  };
  cache.set(resolvedId, gw);
  return gw;
}

/** Lista pública pro endpoint /api/profiles. */
export function listProfiles(): Array<{ id: string; label: string; port: number }> {
  return PROFILE_REGISTRY.map((p) => ({ ...p }));
}

/** Invalida cache da API key (útil em testes / re-load de env). */
export function clearProfileCache(): void {
  cache.clear();
}
