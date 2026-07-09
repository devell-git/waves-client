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
 * Escopo POR SESSÃO (`Map<sessionKey, Progress>`) — cada request ativa tem seu
 * próprio bucket, keyed pelo sessionId do Hermes
 * (`waves-<tenant>-user-<id>::<thread>`). Antes era um buffer global único, o
 * que fazia dois chats simultâneos verem o progresso um do outro no poll.
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

  // --- MCP Omie (erelab) ---
  if (tool.includes("omie_listar_produtos")) return "Consultando catálogo no Omie…";
  if (tool.includes("omie_consultar_produto")) return "Buscando detalhes do produto…";
  if (tool.includes("omie_pesquisar_estoque")) return "Verificando estoque no Omie…";
  if (tool.includes("omie_relatorio_estoque")) return "Montando relatório de estoque…";
  if (tool.includes("omie_calcular_custo")) return "Calculando custo do projeto…";
  if (tool.includes("omie_listar_pedidos")) return "Buscando pedidos de venda…";
  if (tool.includes("omie")) return "Consultando o Omie…";

  // --- MCP IAPP (erelab) ---
  if (tool.includes("iapp_listar_produtos")) return "Buscando produtos no IAPP…";
  if (tool.includes("iapp_consultar_produto")) return "Consultando produto no IAPP…";
  if (tool.includes("iapp_listar_fichas")) return "Buscando fichas técnicas…";
  if (tool.includes("iapp_consultar_ficha")) return "Lendo ficha técnica com BOM…";
  if (tool.includes("iapp_listar_ordens")) return "Buscando ordens de produção…";
  if (tool.includes("iapp_consultar_ordem")) return "Detalhando ordem de produção…";
  if (tool.includes("iapp_materiais_previstos")) return "Levantando materiais da OP…";
  if (tool.includes("iapp_consumos")) return "Verificando consumos da OP…";
  if (tool.includes("iapp_listar_lotes")) return "Buscando lotes de estoque…";
  if (tool.includes("iapp_listar_depositos")) return "Consultando depósitos…";
  if (tool.includes("iapp_estoques")) return "Verificando posição de estoque…";
  if (tool.includes("iapp")) return "Consultando o IAPP…";

  // --- MCP Markitdown ---
  if (tool.includes("converter_arquivo")) return "Lendo o arquivo enviado…";

  // --- Python sandbox ---
  if (tool.includes("python_sandbox") || tool.includes("run_python")) return "Processando dados…";

  // Genérico
  return "Trabalhando nisso…";
}

/** Progresso por sessão (chave = sessionId do Hermes). */
const bySession = new Map<string, ToolProgress>();
const STALE_MS = 10_000;

/** Remove entradas antigas pra o Map não crescer indefinidamente. */
function pruneStale(now: number): void {
  for (const [key, p] of bySession) {
    if (now - p.ts > STALE_MS) bySession.delete(key);
  }
}

export function setProgress(
  sessionKey: string,
  p: Omit<ToolProgress, "ts" | "humanLabel">,
): void {
  if (!sessionKey) return;
  const now = Date.now();
  pruneStale(now);
  bySession.set(sessionKey, {
    ...p,
    humanLabel: humanizeProgress(p.tool, p.label),
    ts: now,
  });
}

/**
 * Devolve o progresso da sessão informada. Considera stale (>10s sem update)
 * como null pra evitar mostrar tool antiga depois que a request terminou.
 */
export function getProgress(sessionKey: string): ToolProgress | null {
  if (!sessionKey) return null;
  const p = bySession.get(sessionKey);
  if (!p) return null;
  if (Date.now() - p.ts > STALE_MS) {
    bySession.delete(sessionKey);
    return null;
  }
  return p;
}

export function clearProgress(sessionKey: string): void {
  if (sessionKey) bySession.delete(sessionKey);
}
