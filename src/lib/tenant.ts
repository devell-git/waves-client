/**
 * Branding do tenant resolvido pela ORIGEM (host) da requisição.
 *
 * O servidor (`GET /api/tenant`) resolve o tenant pelo Host e devolve só o que
 * é público: id + logos + imagem de login. Usado na tela de login (antes de
 * autenticar) e em qualquer lugar que precise da marca do tenant.
 */

export interface TenantBranding {
  tenant: string;
  logo_white?: string;
  logo_dark?: string;
  img_login?: string;
  /** Base WEB do tenant (pro forgot-password etc.). */
  web_url?: string;
  /** URL de "esqueci a senha" do tenant. */
  forgot_password_url?: string;
}

export async function fetchTenantBranding(): Promise<TenantBranding | null> {
  try {
    const r = await fetch("/api/tenant", { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as TenantBranding;
    return j && typeof j.tenant === "string" ? j : null;
  } catch {
    return null;
  }
}

/** Retorna `value` se for uma string não-vazia, senão `fallback`. */
export function brandOr(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value : fallback;
}
