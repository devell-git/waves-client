/**
 * Cache idempotente do RESULTADO de relatórios genui (AnalysisReport / exec analítico).
 *
 * PROBLEMA (task #791): o marcador (`analysis_report:{...}`) é persistido na thread,
 * mas o HTML gerado NÃO. Como esses relatórios chamam o LLM (`/api/analysis-report`,
 * NÃO-determinístico), cada remount — reload (F5) ou troca de chat — regenerava um
 * relatório DIFERENTE do que estava na tela.
 *
 * Aqui guardamos o HTML por (thread + params do marcador) e hidratamos no remount em
 * vez de re-buscar → o reload restaura EXATAMENTE o mesmo relatório. Mesma família de
 * [[createtask-consumed]] / shortcut-history. Persistido em localStorage (sobrevive a
 * reload/troca/aba), FIFO com teto pra não crescer sem limite.
 */
const LS_KEY = "waves:report-cache";
const MAX_ENTRIES = 80; // relatórios são grandes; teto baixo é proposital

// Thread ativa — gravada pelo ChatPage no render (mesmo padrão do kanban-context).
let activeThreadKey = "";

export function setReportThreadKey(key: string): void {
  activeThreadKey = key || "";
}

interface Entry {
  k: string;
  html: string;
}

function load(): Entry[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as Entry[]) : [];
  } catch {
    return [];
  }
}

function persist(list: Entry[]): void {
  try {
    const trimmed =
      list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
    window.localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage cheio/indisponível — cache degrada, não quebra o relatório */
  }
}

function keyFor(paramsKey: string): string {
  return `${activeThreadKey}::${paramsKey}`;
}

/** HTML já gerado pra esse relatório nesta thread, ou null. */
export function getCachedReport(paramsKey: string): string | null {
  const k = keyFor(paramsKey);
  const hit = load().find((e) => e.k === k);
  return hit ? hit.html : null;
}

/** Guarda o HTML gerado (idempotência: remount com os mesmos params hidrata isto). */
export function putCachedReport(paramsKey: string, html: string): void {
  if (!html) return;
  const k = keyFor(paramsKey);
  const list = load().filter((e) => e.k !== k);
  list.push({ k, html });
  persist(list);
}
