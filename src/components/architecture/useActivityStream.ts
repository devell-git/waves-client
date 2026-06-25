// Hook SSE para o Architecture Explorer — recebe eventos de atividade dos agentes
// em tempo real via GET /api/architecture/stream (serve.py → collector.py).
// Desacoplamento §1: fala só HTTP (SSE), não lê filesystem do Hermes.
import { useEffect, useRef, useState, useCallback } from "react";

export interface ActivityEvent {
  ts: string;
  profile: string;
  event: "tool_call" | "tool_result" | "tool_error" | "user_msg" | "assistant_msg" | "delegation" | "delegation_return" | "processing_start" | "processing_end";
  tool: string; // tool name for tool_call/result, message preview for user/assistant_msg
  detail?: string; // tool arguments (tool_call), tool output (tool_result), or empty
  target_profile?: string; // for delegation: which sub-agent was called
  job_id?: string; // for delegation_return: specialist job ID
  session_id?: number;
  user_id?: string;
  source?: string;
}

interface GraphUpdateEvent {
  counts: Record<string, number>;
  total_edges: number;
  generated_at: string;
}

interface ActivityState {
  /** Profiles com atividade recente (últimos 10s) — para pulsar o node */
  activeProfiles: Set<string>;
  /** Últimas tool calls por profile (para a sidebar) */
  recentCalls: Map<string, ActivityEvent[]>;
  /** Último graph update recebido */
  lastGraphUpdate: GraphUpdateEvent | null;
  /** SSE conectado? */
  connected: boolean;
}

const MAX_RECENT = 20; // últimas N calls por profile na memória
const ACTIVE_TTL_MS = 10_000; // profile "ativo" por 10s após última call

/**
 * Conecta ao SSE /api/architecture/stream e mantém estado de atividade.
 * Retorna quais profiles estão ativos (para pulsar) e as últimas calls (para sidebar).
 */
export function useActivityStream(
  accessToken: string,
  enabled: boolean,
): ActivityState {
  const [activeProfiles, setActiveProfiles] = useState<Set<string>>(new Set());
  const [recentCalls, setRecentCalls] = useState<Map<string, ActivityEvent[]>>(new Map());
  const [lastGraphUpdate, setLastGraphUpdate] = useState<GraphUpdateEvent | null>(null);
  const [connected, setConnected] = useState(false);

  // Timers para expirar atividade
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const markActive = useCallback((profile: string) => {
    setActiveProfiles((prev) => {
      const next = new Set(prev);
      next.add(profile);
      return next;
    });

    // Limpar timer anterior e criar novo (expira em ACTIVE_TTL_MS)
    const existing = timersRef.current.get(profile);
    if (existing) clearTimeout(existing);
    timersRef.current.set(
      profile,
      setTimeout(() => {
        setActiveProfiles((prev) => {
          const next = new Set(prev);
          next.delete(profile);
          return next;
        });
        timersRef.current.delete(profile);
      }, ACTIVE_TTL_MS),
    );
  }, []);

  const addCalls = useCallback((events: ActivityEvent[]) => {
    setRecentCalls((prev) => {
      const next = new Map(prev);
      for (const ev of events) {
        const list = next.get(ev.profile) ?? [];
        list.push(ev);
        // Trim
        if (list.length > MAX_RECENT) list.splice(0, list.length - MAX_RECENT);
        next.set(ev.profile, list);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const url = `/api/architecture/stream`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    // Tool call activity
    es.addEventListener("activity", (e) => {
      try {
        const events: ActivityEvent[] = JSON.parse(e.data);
        addCalls(events);
        // Mark active
        const profiles = new Set(events.map((ev) => ev.profile));
        for (const p of profiles) markActive(p);
      } catch {
        /* parse error — ignore */
      }
    });

    // Graph structure update
    es.addEventListener("graph-update", (e) => {
      try {
        const update: GraphUpdateEvent = JSON.parse(e.data);
        setLastGraphUpdate(update);
      } catch {
        /* ignore */
      }
    });

    return () => {
      es.close();
      setConnected(false);
      // Cleanup timers
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, [enabled, accessToken, markActive, addCalls]);

  return { activeProfiles, recentCalls, lastGraphUpdate, connected };
}
