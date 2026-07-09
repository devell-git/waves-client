import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { verifyApiSession } from "./api/waves-api";
import { LoginPage } from "./components/LoginPage";
import { ChatPage } from "./components/ChatPage";
import "./components/tokens/tokens.css";
import { clearSession, loadSession, saveSession } from "./lib/session";
import { purgeUserScopedCaches } from "./lib/user-cache";
import { fetchTenantBranding } from "./lib/tenant";
import { APP_ROUTES, renderGuardedRoute } from "./modules/app-routes";
import type { AuthSession } from "./types/auth";

/**
 * Rotas: `/login` (tela de login) e `/chat` (tela de chat), separadas por URL
 * com guarda de auth. Sem sessão e indo pro `/chat` → redireciona pro `/login`;
 * logado e indo pro `/login` → vai pro `/chat`. Qualquer outra rota cai no
 * destino certo conforme a sessão.
 */
export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const stored = loadSession();
      if (!stored) {
        if (!cancelled) setChecking(false);
        return;
      }

      const valid = await verifyApiSession(stored);
      if (cancelled) return;

      if (valid) {
        // Backfill do tenant em sessões antigas (pré-multi-tenant) pra o
        // prefixo das threads no front bater com o do servidor (host-resolved).
        let next = stored;
        if (!next.tenant) {
          const b = await fetchTenantBranding();
          if (cancelled) return;
          if (b?.tenant) {
            next = { ...next, tenant: b.tenant };
            saveSession(next);
          }
        }
        setSession(next);
      } else {
        clearSession();
      }
      setChecking(false);
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Título da aba = nome do tenant (resolvido pelo host via /api/tenant), sem
  // "Waves" hardcoded. Base global (login + chat); o ChatPage refina com o
  // page_title do agente. Fallback = hostname literal (= "o nome do host").
  useEffect(() => {
    fetchTenantBranding().then((b) => {
      document.title = b?.tenant?.trim() || window.location.hostname;
    });
  }, []);

  const handleLogin = useCallback(
    (next: AuthSession) => {
      // Autenticação NOVA → zera qualquer cache de um usuário anterior no mesmo
      // navegador (relatórios, jobs, workflows, threads). Não roda no restore
      // (reload do mesmo usuário), só no login explícito.
      purgeUserScopedCaches();
      setSession(next);
      navigate("/chat", { replace: true });
    },
    [navigate],
  );

  const handleLogout = useCallback(() => {
    // Evicta o token do cache dos gateways dos agents do usuário + revoga na
    // Waves (best-effort, fire-and-forget — não atrasa a saída).
    if (session?.accessToken) {
      const gateways = (session.agents ?? [])
        .filter((a) => typeof a.port === "number")
        .map((a) => ({ host: a.host, port: a.port }));
      void fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.accessToken, gateways }),
      }).catch(() => {});
    }
    clearSession();
    purgeUserScopedCaches();
    setSession(null);
    navigate("/login", { replace: true });
  }, [navigate, session]);

  if (checking) {
    return (
      <div className="app-loading">
        <p>Verificando sessão…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          session ? (
            <Navigate to="/chat" replace />
          ) : (
            <LoginPage onLogin={handleLogin} />
          )
        }
      />
      <Route
        path="/chat"
        element={
          session ? (
            <ChatPage session={session} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      {APP_ROUTES.map((def) => (
        <Route
          key={def.path}
          path={def.path}
          element={renderGuardedRoute(def, session)}
        />
      ))}
      <Route path="*" element={<Navigate to={session ? "/chat" : "/login"} replace />} />
    </Routes>
  );
}
