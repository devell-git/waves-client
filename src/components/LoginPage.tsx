import { useEffect, useState } from "react";
import { loginApi } from "../api/waves-api";
import { isEnvConfigured } from "../config/env";
import { createSession, saveSession } from "../lib/session";
import { fetchTenantBranding, type TenantBranding } from "../lib/tenant";
import type { AuthSession } from "../types/auth";

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState<TenantBranding | null>(null);

  // Branding do tenant da origem (logos + imagem de login).
  useEffect(() => {
    let alive = true;
    fetchTenantBranding().then((b) => {
      if (alive) setBranding(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Branding 100% do TENANT (sem fallback hardcoded). Ausente → neutro/branco.
  const logoUrl =
    branding?.logo_dark?.trim() || branding?.logo_white?.trim() || "";
  const heroUrl = branding?.img_login?.trim() || "";
  const heroMobileUrl = heroUrl;
  const forgotUrl = branding?.forgot_password_url?.trim() || "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isEnvConfigured()) {
      setError("Configure VITE_WAVES_URL e VITE_WAVES_TOKEN no arquivo .env.");
      return;
    }

    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }

    setLoading(true);
    try {
      const result = await loginApi(email.trim(), password);
      // Tenant da origem (host) — vincula as threads. Usa o já carregado ou
      // resolve agora se ainda não chegou.
      const tenantId =
        branding?.tenant ?? (await fetchTenantBranding())?.tenant ?? undefined;
      const session = createSession(result, tenantId);
      saveSession(session);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setLoading(false);
    }
  }

  const envReady = isEnvConfigured();

  return (
    <div className="login-layout">
      <section className="login-panel">
        <div className="login-panel-inner">
          {logoUrl && (
            <img className="login-logo" src={logoUrl} alt={branding?.tenant ?? ""} />
          )}

          <h1 className="login-headline">Inteligência que Simplifica</h1>
          <p className="login-tagline">
            Tecnologia e automação para transformar a sua clínica.
          </p>

          <form className="login-form" onSubmit={handleSubmit}>
            {!envReady && (
              <div className="alert alert-warning">
                Configure <code>VITE_WAVES_URL</code> e <code>VITE_WAVES_TOKEN</code> no{" "}
                <code>.env</code>.
              </div>
            )}

            {error && <div className="alert alert-error">{error}</div>}

            <label className="field" htmlFor="login-email">
              <span>Endereço de E-mail</span>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Digite o endereço de email"
                disabled={loading}
                required
              />
            </label>

            <div className="field field--password">
              <div className="field-password-row">
                <label htmlFor="login-password">Digite a Senha</label>
                {forgotUrl && (
                  <a
                    className="login-forgot"
                    href={forgotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Esqueceu a Senha?
                  </a>
                )}
              </div>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite a senha"
                disabled={loading}
                required
              />
            </div>

            <button
              type="submit"
              className="btn-login"
              disabled={loading || !envReady}
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </section>

      <section
        className="login-hero"
        style={
          {
            // Sem img do tenant → "none" (painel neutro, sem url("") quebrado).
            "--login-hero": heroUrl ? `url("${heroUrl}")` : "none",
            "--login-hero-mobile": heroMobileUrl ? `url("${heroMobileUrl}")` : "none",
          } as React.CSSProperties
        }
        aria-hidden="true"
      />
    </div>
  );
}
