// Resolve o id do usuário Waves a partir do Bearer, com cache curto — pra
// autenticar endpoints (ex.: notificações) sem bater na Waves a cada poll.
import { getWavesUser, type WavesSession } from "./waves-client.js";

const TTL_MS = 60_000;
const cache = new Map<string, { id: number; at: number }>();
const adminCache = new Map<string, { admin: boolean; at: number }>();

function bearer(authHeader: string | undefined): string | null {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** id do usuário Waves do token, ou null se ausente/inválido. Cacheia ~60s. */
export async function userIdFromBearer(
  authHeader: string | undefined,
  env: WavesSession["environment"] = "prod",
): Promise<number | null> {
  const token = bearer(authHeader);
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  try {
    const u = await getWavesUser({ environment: env, accessToken: token });
    cache.set(token, { id: u.id, at: Date.now() });
    return u.id;
  } catch {
    return null;
  }
}

/** `true` se o usuário do token é admin (campo `type` da Waves contém "admin",
 * ex.: "Super Admin"). Deriva do Bearer — NUNCA confia em flag da query.
 * Cacheia ~60s. Usado pra gatear endpoints admin-only (ex.: architecture graph). */
export async function isAdminFromBearer(
  authHeader: string | undefined,
  env: WavesSession["environment"] = "prod",
): Promise<boolean> {
  const token = bearer(authHeader);
  if (!token) return false;
  const hit = adminCache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.admin;
  try {
    const u = await getWavesUser({ environment: env, accessToken: token }) as Record<string, unknown>;
    const type = String(u.type ?? "");
    const roles = Array.isArray(u.roles) ? (u.roles as unknown[]).map((r) => String((r as { name?: unknown })?.name ?? r)).join(",") : "";
    const admin = /admin/i.test(type) || /admin/i.test(roles);
    adminCache.set(token, { admin, at: Date.now() });
    return admin;
  } catch {
    return false;
  }
}
