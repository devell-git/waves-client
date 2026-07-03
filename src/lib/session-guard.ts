// Ciclo de vida da sessão no CLIENTE (#790, Fase 1).
//
// - Logout por INATIVIDADE: 6h sem mouse/teclado/touch/scroll/atividade.
// - Logout por EXPIRAÇÃO absoluta do token (expiresAt da sessão).
// - AVISO ~5 min antes de expirar (showWarning) pra o usuário salvar o trabalho.
//
// O "motivo" (expired | inactivity) é passado pra LoginPage via sessionStorage,
// pra a tela de login mostrar a mensagem certa.

import { useEffect, useRef, useState } from "react";

export type ExpireReason = "expired" | "inactivity";

const INACTIVITY_MS = Infinity; // Desabilitado — logout só manual
const WARN_BEFORE_MS = 5 * 60_000; // avisa 5 min antes da expiração absoluta
const CHECK_INTERVAL_MS = 30_000; // checa a cada 30s

const EXPIRED_REASON_KEY = "waves_session_expired_reason";

export function setExpiredReason(reason: ExpireReason): void {
  try {
    sessionStorage.setItem(EXPIRED_REASON_KEY, reason);
  } catch {
    /* modo privado / indisponível */
  }
}

/** Lê e LIMPA o motivo da última expiração (consumido pela LoginPage). */
export function takeExpiredReason(): ExpireReason | null {
  try {
    const r = sessionStorage.getItem(EXPIRED_REASON_KEY);
    if (r) sessionStorage.removeItem(EXPIRED_REASON_KEY);
    return r === "expired" || r === "inactivity" ? r : null;
  } catch {
    return null;
  }
}

/**
 * Guarda o ciclo de vida da sessão. Chama `onExpire(reason)` UMA vez quando
 * expira (por inatividade ou tempo absoluto). Retorna o estado do aviso pré-
 * expiração pra a UI renderizar. `bumpActivity()` reseta o timer de inatividade
 * (use ao enviar mensagem de chat, que não gera evento de DOM aqui).
 */
export function useSessionGuard(opts: {
  expiresAt: number | undefined;
  onExpire: (reason: ExpireReason) => void;
}): { showWarning: boolean; dismissWarning: () => void; bumpActivity: () => void } {
  const { expiresAt, onExpire } = opts;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const lastActivityRef = useRef<number>(Date.now());
  const firedRef = useRef(false);
  const dismissedRef = useRef(false);
  const [showWarning, setShowWarning] = useState(false);

  // Atividade do usuário → reseta o timer de inatividade.
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, []);

  // Checagem periódica: inatividade + expiração absoluta + aviso.
  useEffect(() => {
    firedRef.current = false;
    dismissedRef.current = false;
    setShowWarning(false);
    lastActivityRef.current = Date.now();

    const tick = () => {
      if (firedRef.current) return;
      const now = Date.now();
      if (now - lastActivityRef.current >= INACTIVITY_MS) {
        firedRef.current = true;
        onExpireRef.current("inactivity");
        return;
      }
      if (typeof expiresAt === "number" && expiresAt > 0) {
        if (now >= expiresAt) {
          firedRef.current = true;
          onExpireRef.current("expired");
          return;
        }
        if (!dismissedRef.current && now >= expiresAt - WARN_BEFORE_MS) {
          setShowWarning(true);
        }
      }
    };

    const id = setInterval(tick, CHECK_INTERVAL_MS);
    tick();
    return () => clearInterval(id);
  }, [expiresAt]);

  return {
    showWarning,
    dismissWarning: () => {
      dismissedRef.current = true;
      setShowWarning(false);
    },
    bumpActivity: () => {
      lastActivityRef.current = Date.now();
    },
  };
}
