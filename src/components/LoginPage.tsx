import { useState } from "react";
import { loginApi } from "../api/waves-api";
import { isEnvConfigured } from "../config/env";
import { createSession, saveSession } from "../lib/session";
import type { AuthSession } from "../types/auth";

const WAVES_LOGIN_ASSETS =
  "https://waves.devell.com.br/storage/app/tenants/waves/landing-page/login";

const LOGIN_LOGO_URL = `${WAVES_LOGIN_ASSETS}/login_image.png`;
const LOGIN_HERO_URL = `${WAVES_LOGIN_ASSETS}/login_bg_image.jpg`;
const LOGIN_HERO_MOBILE_URL = `${WAVES_LOGIN_ASSETS}/login_mobile_bg_image.jpg`;
const FORGOT_PASSWORD_URL = "https://waves.devell.com.br/forgot-password";

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const session = createSession(result);
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
          <img className="login-logo" src={LOGIN_LOGO_URL} alt="Waves" />

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
                <a
                  className="login-forgot"
                  href={FORGOT_PASSWORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Esqueceu a Senha?
                </a>
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
            "--login-hero": `url("${LOGIN_HERO_URL}")`,
            "--login-hero-mobile": `url("${LOGIN_HERO_MOBILE_URL}")`,
          } as React.CSSProperties
        }
        aria-hidden="true"
      />
    </div>
  );
}
