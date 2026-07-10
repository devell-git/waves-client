import type { ProfileStarter } from "../../api/runtime";
import type { ProfileOption } from "../ProfileSelect";
import type { AgentItem } from "../../types/auth";

export function pickIcon(displayText: string): string {
  const t = displayText.toLowerCase();
  if (/cnpj|empresa|due diligence/.test(t)) return "🏢";
  if (/cpf|pessoa/.test(t)) return "👤";
  if (/dashboard|gráfico|chart|kpi/.test(t)) return "📊";
  if (/kanban|workflow|board/.test(t)) return "📋";
  if (/funil|funnel/.test(t)) return "🔻";
  if (/agenda|appointment|consulta/.test(t)) return "📅";
  if (/skill|ferramenta|tool/.test(t)) return "🧰";
  if (/relatório|report/.test(t)) return "📄";
  return "✨";
}

function mapPlatformStarter(s: unknown): ProfileStarter | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const display = o.displayText ?? o.title ?? o.label ?? o.text ?? o.name;
  if (display == null || String(display).trim() === "") return null;
  const prompt = o.prompt ?? o.message ?? o.content ?? display;
  const icon = typeof o.icon === "string" ? o.icon : undefined;
  return { displayText: String(display), prompt: String(prompt), icon };
}

export function platformStartersFor(
  activeProfile: string,
  available: ProfileOption[],
  agents: AgentItem[] | undefined,
): ProfileStarter[] {
  const port = available.find((p) => p.id === activeProfile)?.port;
  if (port == null) return [];
  const agent = (agents ?? []).find((a) => a.port === port);
  const raw = agent?.starters;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map(mapPlatformStarter)
    .filter((x): x is ProfileStarter => x != null);
}

export function stripNullArgs(s: string): string {
  return s.replace(
    /(GenerateExecutiveUpdate|GenerateReportPdf)\s*\(([^()]*)\)/g,
    (_full, name: string, args: string) => {
      const kept = args
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((a) => a.trim())
        .filter((a) => a !== "null" && a !== "");
      return `${name}(${kept.join(", ")})`;
    },
  );
}

const ANALYSIS_REPORT_RE = /analysis_report\s*:\s*(\{[\s\S]*\})/;
export function parseAnalysisReport(
  content: string,
): { workflow_id: number; instruction: string; ap_number?: string; scope?: string } | null {
  const m = content.match(ANALYSIS_REPORT_RE);
  if (!m) return null;
  try {
    type AnalysisPayload = { workflow_id?: unknown; instruction?: unknown; ap_number?: unknown; scope?: unknown };
    let jsonStr = m[1];
    let o: AnalysisPayload | null = null;
    for (let attempt = 0; attempt < 3 && !o; attempt++) {
      try {
        o = JSON.parse(jsonStr) as AnalysisPayload;
      } catch {
        jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    if (!o) return null;
    const wf = Number(o.workflow_id);
    const scope = typeof o.scope === "string" ? o.scope : undefined;
    const isProject = scope === "project" || (!Number.isFinite(wf) && !o.ap_number);
    if (!Number.isFinite(wf) && !isProject) return null;
    return {
      workflow_id: Number.isFinite(wf) ? wf : 0,
      instruction: typeof o.instruction === "string" ? o.instruction : "Análise executiva.",
      ap_number: o.ap_number != null ? String(o.ap_number) : undefined,
      scope: isProject ? "project" : scope,
    };
  } catch {
    return null;
  }
}

const EXEC_REPORT_RE = /exec_report\s*:\s*(\{[\s\S]*?\})/;
const EXEC_MODES = ["completo", "resumido", "analitico"];
export function execReportToOpenui(content: string): string | null {
  const m = content.match(EXEC_REPORT_RE);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as { workflow_id?: unknown; ap_number?: unknown; mode?: unknown };
    const wf = Number(o.workflow_id);
    if (!Number.isFinite(wf)) return null;
    const ap = o.ap_number != null ? String(o.ap_number).replace(/"/g, "") : "";
    const mode = EXEC_MODES.includes(String(o.mode)) ? String(o.mode) : "completo";
    return `root = GenerateExecutiveUpdate(${wf}, "${ap}", "${mode}")`;
  } catch {
    return null;
  }
}
