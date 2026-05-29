/**
 * Buffer in-memory pro último progresso de tool reportado pelo Hermes
 * durante uma request ativa.
 *
 * O Hermes emite eventos SSE do tipo `event: hermes.tool.progress` com
 * payload `{tool, emoji, label, toolCallId, status}` durante execução de
 * tool_calls longos. O chat.ts captura, atualiza este buffer, e o frontend
 * (ThinkingIndicator) faz polling do endpoint `/api/chat/progress` pra
 * mostrar pro usuário o que o agente está fazendo agora.
 *
 * Escopo global (sem sessionId) — o waves_client tem ~1 request ativa por
 * vez. Se virar multi-tenant, dá pra evoluir pra Map<sessionId, Progress>.
 */

export interface ToolProgress {
  tool: string;
  emoji?: string;
  label?: string;
  toolCallId?: string;
  status: "running" | "completed";
  /**
   * Mensagem em linguagem natural ("Buscando os Action Plans...") gerada
   * a partir do tool + label técnico. Frontend mostra essa em vez do
   * nome técnico — fica parecendo o agente conversando.
   */
  humanLabel?: string;
  /** Quando atualizado (epoch ms). */
  ts: number;
}

/**
 * Traduz um par (tool, label técnico) numa mensagem em linguagem natural
 * pra mostrar pro usuário durante a request. Tem matches específicos pros
 * endpoints/skills mais comuns do BioShield e fallbacks genéricos por
 * categoria. O label técnico vem direto do Hermes (ex: "raw GET workflows/58/statistics/overview").
 */
function humanizeProgress(tool: string, label?: string): string {
  const l = (label || "").toLowerCase();

  // --- skill_view: consultando referência ---
  if (tool === "skill_view") {
    if (l.includes("manage-workflows")) return "Consultando referência de workflows…";
    if (l.includes("manage-tasks")) return "Consultando referência de tasks…";
    if (l.includes("manage-task-types")) return "Consultando tipos de task…";
    if (l.includes("manage-boards")) return "Consultando referência de boards…";
    if (l.includes("move-task-in-kanban")) return "Consultando regras de movimento no kanban…";
    if (l.includes("authenticate")) return "Validando autenticação…";
    if (l.includes("openui")) return "Consultando referência de UI…";
    if (l.includes("render-dashboard")) return "Consultando estilos de dashboard…";
    if (l.includes("waves-cli")) return "Consultando comandos da Waves…";
    if (l.includes("cdmo")) return "Consultando conhecimento técnico CDMO…";
    if (l.includes("projeto-bioshield")) return "Consultando contexto do projeto…";
    return "Consultando referência…";
  }

  // --- terminal: chamadas à API Waves via waves_client.py raw ---
  if (tool === "terminal") {
    if (l.includes("statistics/overview")) return "Buscando panorama do projeto…";
    if (l.includes("statistics/by-stage")) return "Distribuindo tasks por stage…";
    if (l.includes("statistics/by-user")) return "Vendo carga por responsável…";
    if (l.includes("statistics/by-task-type")) return "Categorizando tasks por tipo…";
    if (l.includes("statistics/timeline")) return "Levantando série temporal…";
    if (l.includes("statistics")) return "Buscando estatísticas…";
    if (l.includes("/kanban")) return "Olhando o kanban completo…";
    if (l.includes("/tasks")) return "Buscando lista de tasks…";
    if (l.includes("workflows") && l.includes("get")) return "Consultando o workflow…";
    if (l.includes("workflows")) return "Buscando os Action Plans…";
    if (l.includes("/users")) return "Buscando responsáveis…";
    if (l.includes("/funnel")) return "Buscando funil…";
    if (l.includes("/comments")) return "Lendo comentários…";
    if (l.includes("/move")) return "Movendo no kanban…";
    if (l.includes("/history")) return "Lendo histórico…";
    if (l.includes("waves_client.py")) return "Conversando com a Waves…";
    if (l.includes("jq ") || l.includes("/tmp/")) return "Filtrando os dados…";
    return "Executando comando…";
  }

  // --- write_file / file: salvando dados intermediários ---
  if (tool === "write_file" || tool === "file") return "Anotando dados intermediários…";

  // --- skills_list, skill_manage: navegação de skills ---
  if (tool === "skills_list") return "Olhando as referências disponíveis…";
  if (tool === "skill_manage") return "Atualizando referências…";

  // --- memory: snapshots de memória do user ---
  if (tool === "memory") return "Consultando memória…";

  // --- web, browser: pesquisa externa ---
  if (tool === "web" || tool === "browser") return "Pesquisando na web…";

  // --- consult_* (sub-agentes especialistas, raros no chat web) ---
  if (tool.startsWith("consult_") || tool.startsWith("mcp_bioshield_consult_")) {
    return "Acionando um especialista…";
  }

  // Genérico
  return "Trabalhando nisso…";
}

let current: ToolProgress | null = null;

export function setProgress(p: Omit<ToolProgress, "ts" | "humanLabel">): void {
  current = {
    ...p,
    humanLabel: humanizeProgress(p.tool, p.label),
    ts: Date.now(),
  };
}

/**
 * Devolve o progresso atual. Considera stale (>10s sem update) como null
 * pra evitar mostrar tool antiga depois que a request terminou.
 */
export function getProgress(): ToolProgress | null {
  if (!current) return null;
  if (Date.now() - current.ts > 10_000) {
    current = null;
    return null;
  }
  return current;
}

export function clearProgress(): void {
  current = null;
}
