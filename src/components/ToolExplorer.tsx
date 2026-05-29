/**
 * Sidebar com as 26 tools da spec OpenUI da Waves.
 *
 * Lê /api/openui/spec (cacheada no Express), agrupa por categoria e permite
 * o user "Pedir ao Steve" — copia prompt natural pro clipboard pra ser
 * colado no input do chat.
 *
 * Não usa hooks do openuidev (FullScreen wrappa o ChatProvider próprio,
 * então não há jeito limpo de chamar processMessage de fora sem refactor).
 */
import { useEffect, useMemo, useState } from "react";
import {
  buildPromptForTool,
  buildToolGroups,
  fetchOpenUISpec,
  filterTools,
  type OpenUISpec,
  type OpenUITool,
} from "../api/openui-spec";

interface ToolExplorerProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function ToolExplorer({ collapsed, onToggle }: ToolExplorerProps) {
  const [spec, setSpec] = useState<OpenUISpec | null>(null);
  const [query, setQuery] = useState("");
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [copiedTool, setCopiedTool] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOpenUISpec().then((s) => {
      if (!cancelled) setSpec(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!spec) return [];
    const all = buildToolGroups(spec);
    if (!query.trim()) return all;
    return all
      .map((g) => ({ ...g, tools: filterTools(g.tools, query) }))
      .filter((g) => g.tools.length > 0);
  }, [spec, query]);

  async function copyPrompt(tool: OpenUITool): Promise<void> {
    const prompt = buildPromptForTool(tool, {});
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedTool(tool.name);
      setTimeout(() => setCopiedTool((v) => (v === tool.name ? null : v)), 2500);
    } catch {
      // fallback: mostra prompt num prompt() pra user copiar manual
      window.prompt("Copie o prompt e cole no chat:", prompt);
    }
  }

  if (collapsed) {
    return (
      <aside className="tool-explorer tool-explorer-collapsed">
        <button
          type="button"
          className="tool-explorer-toggle"
          onClick={onToggle}
          title="Abrir Tool Explorer"
          aria-label="Abrir Tool Explorer"
        >
          🛠️
        </button>
      </aside>
    );
  }

  return (
    <aside className="tool-explorer">
      <header className="tool-explorer-header">
        <div>
          <strong>Tools Waves</strong>
          {spec && <span className="tool-explorer-count"> · {spec.counts.tools}</span>}
        </div>
        <button
          type="button"
          className="tool-explorer-toggle"
          onClick={onToggle}
          title="Fechar"
          aria-label="Fechar Tool Explorer"
        >
          ✕
        </button>
      </header>

      <input
        type="search"
        className="tool-explorer-search"
        placeholder="Buscar tool…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      {!spec && <p className="tool-explorer-empty">Carregando spec…</p>}
      {spec && groups.length === 0 && (
        <p className="tool-explorer-empty">Nenhuma tool casa com “{query}”.</p>
      )}

      <div className="tool-explorer-groups">
        {groups.map((g) => (
          <section key={g.category} className="tool-group">
            <h4 className="tool-group-label">
              {g.label}
              <span className="tool-group-count">{g.tools.length}</span>
            </h4>
            <ul className="tool-list">
              {g.tools.map((t) => {
                const open = openTool === t.name;
                return (
                  <li key={t.name} className={open ? "tool-item open" : "tool-item"}>
                    <button
                      type="button"
                      className="tool-item-header"
                      onClick={() => setOpenTool(open ? null : t.name)}
                    >
                      <span className="tool-name">{t.name}</span>
                      <span className={`tool-method m-${t.endpoint.method.toLowerCase()}`}>
                        {t.endpoint.method}
                      </span>
                    </button>
                    {open && (
                      <div className="tool-detail">
                        <p className="tool-desc">{t.description}</p>
                        <code className="tool-endpoint">{t.endpoint.path}</code>
                        {renderInputs(t)}
                        <button
                          type="button"
                          className="btn-primary tool-cta"
                          onClick={() => copyPrompt(t)}
                        >
                          {copiedTool === t.name ? "✓ Copiado!" : "📋 Pedir ao Steve"}
                        </button>
                        <p className="tool-hint">
                          Cole no input do chat (Ctrl+V) e envie.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function renderInputs(tool: OpenUITool) {
  const props = tool.inputSchema?.properties ?? {};
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return <p className="tool-inputs-empty">Sem parâmetros</p>;
  }
  const required = new Set(tool.inputSchema?.required ?? []);
  return (
    <details className="tool-inputs">
      <summary>
        Parâmetros ({keys.length})
      </summary>
      <ul>
        {keys.map((k) => {
          const p = props[k] as Record<string, unknown>;
          const type = (p?.type as string) ?? "any";
          const desc = (p?.description as string) ?? "";
          return (
            <li key={k}>
              <code>{k}</code>
              <span className="tool-input-type">{type}</span>
              {required.has(k) && <span className="tool-input-req">obrigatório</span>}
              {desc && <span className="tool-input-desc"> — {desc}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
