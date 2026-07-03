/**
 * Token Dashboard — consumo de tokens por profile (admin-only).
 * Rota: /admin/tokens
 * Dados: GET /api/architecture/tokens?days=N
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthSession } from "../../types/auth";

interface ProfileTokens {
  profile: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  first_session: number | null;
  last_session: number | null;
  models: Record<string, { sessions: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
  sources: Record<string, number>;
}

interface TokenData {
  profiles: ProfileTokens[];
  totals: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    sessions: number;
    cost_usd: number;
  };
  days: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  return n > 0 ? `$${n.toFixed(2)}` : "$0";
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

interface Props {
  session: AuthSession;
}

export function TokenDashboard({ session }: Props) {
  const [data, setData] = useState<TokenData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/architecture/tokens?days=${d}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (r.ok) {
        setData(await r.json());
      } else {
        setError(`Erro ${r.status}: ${r.statusText}`);
      }
    } catch (e) {
      setError(`Falha na conexão: ${e instanceof Error ? e.message : "desconhecido"}`);
    }
    setLoading(false);
  }, [session.accessToken]);

  useEffect(() => { fetchData(days); }, [days, fetchData]);

  const totalTokens = data ? data.totals.input_tokens + data.totals.output_tokens : 0;

  return (
    <div className="token-dashboard">
      <header className="token-header">
        <div className="token-header-left">
          <button type="button" className="token-back" onClick={() => navigate("/chat")} title="Voltar">
            &larr;
          </button>
          <h1>Consumo de Tokens</h1>
          <span className="token-subtitle">Últimos {days} dias</span>
        </div>
        <div className="token-filters">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={`token-filter-btn${d === days ? " active" : ""}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {loading && <div className="token-loading">Carregando dados...</div>}

      {error && !loading && (
        <div className="token-loading" style={{ color: "var(--destructive, #dc2626)" }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPIs */}
          <div className="token-kpis">
            <div className="token-kpi">
              <div className="token-kpi-value">{fmt(totalTokens)}</div>
              <div className="token-kpi-label">Tokens totais</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-value">{fmt(data.totals.input_tokens)}</div>
              <div className="token-kpi-label">Input</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-value">{fmt(data.totals.output_tokens)}</div>
              <div className="token-kpi-label">Output</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-value">{data.totals.sessions}</div>
              <div className="token-kpi-label">Sessões</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-value">{fmtCost(data.totals.cost_usd)}</div>
              <div className="token-kpi-label">Custo estimado</div>
            </div>
            <div className="token-kpi">
              <div className="token-kpi-value">{data.profiles.length}</div>
              <div className="token-kpi-label">Profiles ativos</div>
            </div>
          </div>

          {/* Ranking */}
          <div className="token-section">
            <h2>Ranking por consumo</h2>
            <div className="token-table-wrap">
              <table className="token-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Profile</th>
                    <th>Sessões</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Total</th>
                    <th>%</th>
                    <th>Custo</th>
                    <th className="token-bar-col">Proporção</th>
                  </tr>
                </thead>
                <tbody>
                  {data.profiles.map((p, i) => {
                    const total = p.input_tokens + p.output_tokens;
                    const barW = totalTokens > 0 ? (total / totalTokens) * 100 : 0;
                    return (
                      <tr key={p.profile}>
                        <td className="token-rank">{i + 1}</td>
                        <td className="token-profile-name">{p.profile}</td>
                        <td>{p.sessions}</td>
                        <td>{fmt(p.input_tokens)}</td>
                        <td>{fmt(p.output_tokens)}</td>
                        <td className="token-total-cell">{fmt(total)}</td>
                        <td>{pct(total, totalTokens)}</td>
                        <td>{fmtCost(p.cost_usd)}</td>
                        <td className="token-bar-col">
                          <div className="token-bar-bg">
                            <div className="token-bar-fill" style={{ width: `${barW}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Breakdown por modelo */}
          <div className="token-section">
            <h2>Por modelo</h2>
            <div className="token-model-grid">
              {(() => {
                const models: Record<string, { sessions: number; input: number; output: number; cost: number }> = {};
                for (const p of data.profiles) {
                  for (const [m, d] of Object.entries(p.models)) {
                    if (!models[m]) models[m] = { sessions: 0, input: 0, output: 0, cost: 0 };
                    models[m].sessions += d.sessions;
                    models[m].input += d.input_tokens;
                    models[m].output += d.output_tokens;
                    models[m].cost += d.cost_usd;
                  }
                }
                return Object.entries(models)
                  .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
                  .map(([name, d]) => (
                    <div key={name} className="token-model-card">
                      <div className="token-model-name">{name}</div>
                      <div className="token-model-stat">{d.sessions} sessões</div>
                      <div className="token-model-stat">{fmt(d.input + d.output)} tokens</div>
                      <div className="token-model-stat">{fmtCost(d.cost)}</div>
                    </div>
                  ));
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
