// SOC Dashboard — painel operacional em tempo real dos agentes Hermes (#859).
// Consome os mesmos endpoints do Architecture Explorer (SSE + activity + graph).
// Admin-only. Sem backend novo — só frontend.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { AuthSession } from "../../types/auth";
import { fetchArchitectureGraph } from "../../api/architecture";
import {
  useActivityStream,
  type ActivityEvent,
} from "../architecture/useActivityStream";
import "./soc.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/** Busca snapshot de activity (últimas N calls por profile). */
async function fetchActivity(token: string): Promise<Record<string, ActivityEvent[]>> {
  const res = await fetch("/api/architecture/activity?refresh=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const data = await res.json();
  const { _updated, ...profiles } = data;
  return profiles as Record<string, ActivityEvent[]>;
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────
function KPIBar({
  activeCount,
  totalProfiles,
  callsRecent,
  errorsRecent,
  connected,
}: {
  activeCount: number;
  totalProfiles: number;
  callsRecent: number;
  errorsRecent: number;
  connected: boolean;
}) {
  return (
    <div className="soc-kpi-bar">
      <div className="soc-kpi">
        <span className="soc-kpi-value">{activeCount}</span>
        <span className="soc-kpi-label">ativos / {totalProfiles}</span>
      </div>
      <div className="soc-kpi">
        <span className="soc-kpi-value">{callsRecent}</span>
        <span className="soc-kpi-label">calls recentes</span>
      </div>
      <div className="soc-kpi">
        <span className="soc-kpi-value">{errorsRecent}</span>
        <span className="soc-kpi-label">erros</span>
      </div>
      <div className={`soc-kpi soc-kpi--status ${connected ? "soc-kpi--ok" : "soc-kpi--off"}`}>
        <span className="soc-kpi-value">{connected ? "●" : "○"}</span>
        <span className="soc-kpi-label">{connected ? "SSE conectado" : "desconectado"}</span>
      </div>
    </div>
  );
}

// ─── Agent List ───────────────────────────────────────────────────────────
function AgentList({
  profiles,
  activeProfiles,
  recentCalls,
  selectedProfile,
  onSelect,
}: {
  profiles: string[];
  activeProfiles: Set<string>;
  recentCalls: Map<string, ActivityEvent[]>;
  selectedProfile: string | null;
  onSelect: (p: string | null) => void;
}) {
  // Sort: active first, then alphabetical
  const sorted = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const aActive = activeProfiles.has(`profile:${a}`) ? 0 : 1;
      const bActive = activeProfiles.has(`profile:${b}`) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.localeCompare(b, "pt-BR");
    });
  }, [profiles, activeProfiles]);

  return (
    <div className="soc-agents">
      <h3 className="soc-section-title">
        Agentes
        <button
          type="button"
          className="soc-clear-filter"
          onClick={() => onSelect(null)}
          title="Ver todos"
        >
          Todos
        </button>
      </h3>
      <ul className="soc-agent-list">
        {sorted.map((p) => {
          const isActive = activeProfiles.has(`profile:${p}`);
          const calls = recentCalls.get(`profile:${p}`) ?? [];
          const lastCall = calls.length > 0 ? calls[calls.length - 1] : null;
          const isSelected = selectedProfile === p;
          return (
            <li key={p}>
              <button
                type="button"
                className={`soc-agent${isSelected ? " soc-agent--selected" : ""}`}
                onClick={() => onSelect(isSelected ? null : p)}
              >
                <span
                  className={`soc-agent-dot ${isActive ? "soc-agent-dot--active" : ""}`}
                  aria-label={isActive ? "ativo" : "idle"}
                />
                <span className="soc-agent-name">{p}</span>
                {lastCall && (
                  <span className="soc-agent-last" title={`Último: ${lastCall.tool}`}>
                    {lastCall.tool.length > 25
                      ? lastCall.tool.slice(0, 25) + "…"
                      : lastCall.tool}
                  </span>
                )}
                <span className="soc-agent-count">{calls.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────
function Timeline({
  events,
  selectedProfile,
}: {
  events: ActivityEvent[];
  selectedProfile: string | null;
}) {
  const filtered = selectedProfile
    ? events.filter((e) => e.profile === selectedProfile)
    : events;
  const display = filtered.slice(-50).reverse();

  return (
    <div className="soc-timeline">
      <h3 className="soc-section-title">
        Timeline {selectedProfile ? `— ${selectedProfile}` : "— todos"}
      </h3>
      <div className="soc-timeline-feed">
        {display.length === 0 && (
          <p className="soc-empty">Aguardando eventos…</p>
        )}
        {display.map((ev, i) => (
          <div key={`${ev.ts}-${ev.tool}-${i}`} className="soc-event">
            <span className="soc-event-ts">
              {new Date(ev.ts).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={`soc-event-dot ${ev.event === "tool_call" ? "soc-event-dot--call" : "soc-event-dot--result"}`}
              title={ev.event}
            >
              {ev.event === "tool_call" ? "→" : "←"}
            </span>
            <span className="soc-event-profile">{ev.profile}</span>
            <span className="soc-event-tool">{ev.tool}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agent Detail ─────────────────────────────────────────────────────────
function AgentDetail({
  profile,
  calls,
  graphData,
}: {
  profile: string;
  calls: ActivityEvent[];
  graphData: { metrics?: Record<string, unknown> } | null;
}) {
  // Top tools
  const topTools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) {
      counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [calls]);

  const maxCount = topTools.length > 0 ? topTools[0][1] : 1;
  const metrics = graphData?.metrics as Record<string, unknown> | undefined;
  const queue = metrics?.queue as Record<string, number> | undefined;
  const circuit = metrics?.circuit as string | undefined;

  return (
    <div className="soc-detail">
      <h3 className="soc-section-title">Detalhe — {profile}</h3>

      <div className="soc-detail-metrics">
        {circuit && (
          <span className={`soc-detail-chip soc-circuit--${circuit}`}>
            circuit: {circuit}
          </span>
        )}
        {queue &&
          Object.entries(queue).map(([k, v]) => (
            <span key={k} className="soc-detail-chip">
              {k}: {v}
            </span>
          ))}
        <span className="soc-detail-chip">calls: {calls.length}</span>
      </div>

      {topTools.length > 0 && (
        <div className="soc-top-tools">
          <h4>Top tools</h4>
          {topTools.map(([tool, count]) => (
            <div key={tool} className="soc-tool-row">
              <span className="soc-tool-name" title={tool}>
                {tool.length > 35 ? tool.slice(0, 35) + "…" : tool}
              </span>
              <div className="soc-tool-bar-bg">
                <div
                  className="soc-tool-bar"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="soc-tool-count">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inner (with hooks) ──────────────────────────────────────────────────
function SOCInner({ session }: { session: AuthSession }) {
  const navigate = useNavigate();
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  // Fetch graph for profile list + metrics
  const { data: graph } = useQuery({
    queryKey: ["soc-graph"],
    queryFn: () => fetchArchitectureGraph(session.accessToken, false),
    refetchInterval: 60_000,
  });

  // Fetch initial activity snapshot
  const { data: initialActivity } = useQuery({
    queryKey: ["soc-activity"],
    queryFn: () => fetchActivity(session.accessToken),
  });

  // SSE — always on in SOC
  const { activeProfiles, recentCalls, connected } = useActivityStream(
    session.accessToken,
    true,
  );

  // Merge initial activity with SSE events
  const [allEvents, setAllEvents] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    if (initialActivity) {
      const events: ActivityEvent[] = [];
      for (const calls of Object.values(initialActivity)) {
        events.push(...calls);
      }
      events.sort((a, b) => a.ts.localeCompare(b.ts));
      setAllEvents(events);
    }
  }, [initialActivity]);

  // Append SSE events
  useEffect(() => {
    if (recentCalls.size === 0) return;
    const newEvents: ActivityEvent[] = [];
    for (const calls of recentCalls.values()) {
      newEvents.push(...calls);
    }
    if (newEvents.length > 0) {
      setAllEvents((prev) => {
        const merged = [...prev, ...newEvents];
        // Dedup by ts+tool+profile
        const seen = new Set<string>();
        return merged.filter((e) => {
          const key = `${e.ts}:${e.profile}:${e.tool}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(-500); // keep last 500
      });
    }
  }, [recentCalls]);

  // Profile list from graph
  const profiles = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.type === "profile")
      .map((n) => n.label)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [graph]);

  // Selected profile graph data
  const selectedGraphNode = useMemo(() => {
    if (!selectedProfile || !graph) return null;
    return graph.nodes.find((n) => n.label === selectedProfile)?.data ?? null;
  }, [selectedProfile, graph]);

  // Selected profile calls
  const selectedCalls = useMemo(() => {
    if (!selectedProfile) return [];
    return allEvents.filter((e) => e.profile === selectedProfile);
  }, [selectedProfile, allEvents]);

  // KPIs
  const callsRecent = allEvents.length;
  const errorsRecent = 0; // TODO: derive from circuit breakers

  return (
    <div className="soc-dashboard">
      <header className="soc-header">
        <button type="button" className="soc-back" onClick={() => navigate("/chat")}>
          ← Voltar
        </button>
        <h1 className="soc-title">SOC — Hermes Operations</h1>
        <button
          type="button"
          className="soc-nav-explorer"
          onClick={() => navigate("/admin/architecture")}
        >
          Explorer
        </button>
      </header>

      <KPIBar
        activeCount={activeProfiles.size}
        totalProfiles={profiles.length}
        callsRecent={callsRecent}
        errorsRecent={errorsRecent}
        connected={connected}
      />

      <div className="soc-body">
        <AgentList
          profiles={profiles}
          activeProfiles={activeProfiles}
          recentCalls={recentCalls}
          selectedProfile={selectedProfile}
          onSelect={setSelectedProfile}
        />

        <div className="soc-main">
          <Timeline events={allEvents} selectedProfile={selectedProfile} />

          {selectedProfile && (
            <AgentDetail
              profile={selectedProfile}
              calls={selectedCalls}
              graphData={selectedGraphNode as { metrics?: Record<string, unknown> } | null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function SOCDashboard({ session }: { session: AuthSession }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SOCInner session={session} />
    </QueryClientProvider>
  );
}
