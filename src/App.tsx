import { useCallback, useEffect, useState } from "react";
import { verifyApiSession } from "./api/waves-api";
import { ChatPage } from "./components/ChatPage";
import { LoginPage } from "./components/LoginPage";
import { clearSession, loadSession } from "./lib/session";
import type { AuthSession } from "./types/auth";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);

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
        setSession(stored);
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

  const handleLogin = useCallback((next: AuthSession) => {
    setSession(next);
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  if (checking) {
    return (
      <div className="app-loading">
        <p>Verificando sessão…</p>
      </div>
    );
  }

  if (session) {
    return <ChatPage session={session} onLogout={handleLogout} />;
  }

  return <LoginPage onLogin={handleLogin} />;
}
