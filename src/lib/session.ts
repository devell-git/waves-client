import { WAVES_ENVIRONMENT } from "../config/env";
import type { AuthSession, LoginResult } from "../types/auth";

const STORAGE_KEY = "waves_api_session";

function normalizeSession(session: AuthSession): AuthSession {
  return {
    ...session,
    environment: WAVES_ENVIRONMENT,
    roles: session.roles ?? [],
    effectivePermissions: session.effectivePermissions ?? [],
    agents: session.agents ?? [],
  };
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): AuthSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken || !session.user) {
      return null;
    }
    // Sem checagem de expiração — logout só manual.
    return normalizeSession(session);
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createSession(login: LoginResult, tenant?: string): AuthSession {
  const marginMs = 60_000;
  return normalizeSession({
    environment: WAVES_ENVIRONMENT,
    accessToken: login.accessToken,
    expiresAt: Date.now() + login.expiresIn * 1000 - marginMs,
    user: login.user,
    roles: login.roles,
    effectivePermissions: login.effectivePermissions,
    permissionsVersion: login.permissionsVersion,
    agents: login.agents,
    tenant: tenant?.trim() || undefined,
  });
}
