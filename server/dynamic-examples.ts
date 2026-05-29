/**
 * Examples dinâmicos baseados nos DADOS REAIS do user logado.
 *
 * O system prompt fixo tem 13 few-shot examples genéricos (Tabelas, Forms,
 * Charts hardcoded). LLMs tendem a copiar a estrutura desses examples
 * (chain of imitation), gerando UIs sempre parecidas independente da
 * pergunta.
 *
 * Aqui geramos exemplos COM DADOS REAIS do user — ids, nomes, contagens —
 * pra mostrar ao Steve: "este é o jeito que você JÁ pode renderizar
 * informações desse user". Quando ele vir as MESMAS workflows/assistantes/
 * funnels na resposta, copia a estrutura natural em vez de inventar.
 *
 * Não bloqueia o stream — falha silenciosa retorna string vazia.
 * Cache 5min por user_id (mesmo user fazendo várias perguntas reusa).
 */
import {
  getWorkflowKanban,
  getAssistantFunnel,
  type WavesSession,
} from "./waves-client.js";

interface ScopeWorkflow {
  id: number;
  name?: string | null;
}
interface ScopeAssistant {
  id: number;
  name?: string | null;
  title?: string | null;
}

interface DynamicExampleInput {
  session: WavesSession;
  userId: number | string | undefined;
  defaultWorkflowId?: number | null;
  defaultAssistantId?: number | null;
  workflows: ScopeWorkflow[];
  assistants: ScopeAssistant[];
}

interface CacheEntry {
  examples: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function buildDynamicExamples(
  opts: DynamicExampleInput,
): Promise<string> {
  const cacheKey = String(opts.userId ?? "anon");
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.examples;

  const parts: string[] = [];

  // 1. Kanban example a partir do workflow padrão do user
  if (opts.defaultWorkflowId != null) {
    const wfName =
      opts.workflows.find((w) => w.id === opts.defaultWorkflowId)?.name ??
      `Workflow ${opts.defaultWorkflowId}`;
    try {
      const kanban = await getWorkflowKanban(
        opts.session,
        opts.defaultWorkflowId,
      );
      const ex = renderKanbanExample(opts.defaultWorkflowId, wfName, kanban);
      if (ex) parts.push(ex);
    } catch {
      /* sem permissão / workflow inexistente — skip */
    }
  }

  // 2. Funnel example a partir do default assistant
  if (opts.defaultAssistantId != null) {
    const astName =
      opts.assistants.find((a) => a.id === opts.defaultAssistantId)?.name ??
      opts.assistants.find((a) => a.id === opts.defaultAssistantId)?.title ??
      `Assistant ${opts.defaultAssistantId}`;
    try {
      const funnel = await getAssistantFunnel(
        opts.session,
        opts.defaultAssistantId,
      );
      if (funnel) {
        const ex = renderFunnelExample(funnel, astName);
        if (ex) parts.push(ex);
      }
    } catch {
      /* skip */
    }
  }

  let out = "";
  if (parts.length > 0) {
    out =
      "\n\n---\n\n## Exemplos personalizados (gerados com SEUS dados reais)\n\n" +
      "Estes exemplos usam ids, nomes e contagens REAIS deste user. " +
      "Quando renderizar dados similares, use estes padrões como referência " +
      "(adaptando estrutura ao conteúdo).\n\n" +
      parts.join("\n\n");
  }

  cache.set(cacheKey, { examples: out, expiresAt: now + CACHE_TTL_MS });
  return out;
}

// ---------------------------------------------------------------------------
// Renderers — convertem dados da Waves em OpenUI Lang sintético
// ---------------------------------------------------------------------------

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface KanbanStage {
  id: number;
  name?: string;
  tasks?: KanbanTask[];
}
interface KanbanTask {
  id: number;
  title?: string;
}
interface KanbanData {
  data?: {
    kanban?: { stages?: KanbanStage[] };
    stages?: KanbanStage[];
  };
}

function renderKanbanExample(
  workflowId: number,
  wfName: string,
  raw: unknown,
): string | null {
  const d = raw as KanbanData;
  const stages = d?.data?.kanban?.stages ?? d?.data?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;

  // Limita a 4 colunas + 3 tasks por coluna pro example não explodir
  const cols = stages.slice(0, 4);
  const lines: string[] = [];
  lines.push(
    `### Example dinâmico — Kanban do seu workflow "${wfName}" (id ${workflowId})\n`,
  );
  lines.push("```");
  lines.push('root = Stack([header, board, followUps], "column", "m")');
  lines.push(
    `header = Card([CardHeader("${escapeStr(wfName)}", "Kanban com ${cols.length} stages")])`,
  );
  const colIds = cols.map((_, i) => `col${i + 1}`);
  lines.push(
    `board = Stack([${colIds.join(", ")}], "row", "m", "start", "start")`,
  );

  cols.forEach((stage, i) => {
    const tasks = (stage.tasks ?? []).slice(0, 3);
    const colId = colIds[i];
    const headerId = `h${i + 1}`;
    const itemsId = `items${i + 1}`;
    lines.push(`${colId} = Card([${headerId}, ${itemsId}])`);
    lines.push(
      `${headerId} = CardHeader("${escapeStr(stage.name ?? `Stage ${stage.id}`)}", "${tasks.length} tasks")`,
    );
    if (tasks.length === 0) {
      lines.push(`${itemsId} = TextContent("Nenhuma task", "small")`);
    } else {
      const taskIds = tasks.map((_, j) => `t${i + 1}_${j + 1}`);
      lines.push(
        `${itemsId} = Stack([${taskIds.join(", ")}], "column", "s")`,
      );
      tasks.forEach((task, j) => {
        const tId = taskIds[j];
        lines.push(
          `${tId} = Card([TextContent("#${task.id}", "small"), TextContent("${escapeStr(task.title ?? "")}", "small-heavy")])`,
        );
      });
    }
  });

  lines.push("followUps = FollowUpBlock([fu1, fu2])");
  lines.push(
    `fu1 = FollowUpItem("Detalhar tasks da primeira stage do ${escapeStr(wfName)}")`,
  );
  lines.push(`fu2 = FollowUpItem("Dashboard de progresso deste workflow")`);
  lines.push("```");
  return lines.join("\n");
}

interface FunnelStage {
  id: number;
  name?: string | null;
  color?: string | null;
}
interface FunnelData {
  id: number;
  name?: string | null;
  stages?: FunnelStage[];
  stages_count?: number;
}

function renderFunnelExample(
  funnel: FunnelData,
  assistantName: string,
): string | null {
  const stages = (funnel.stages ?? []).slice(0, 8);
  if (stages.length === 0) return null;

  const lines: string[] = [];
  lines.push(
    `### Example dinâmico — Funil do assistant "${assistantName}" (funnel ${funnel.id})\n`,
  );
  lines.push("```");
  lines.push("root = Card([header, list, followUps])");
  lines.push(
    `header = CardHeader("${escapeStr(funnel.name ?? `Funnel ${funnel.id}`)}", "${funnel.stages_count ?? stages.length} stages")`,
  );
  const itemIds = stages.map((_, i) => `s${i + 1}`);
  lines.push(`list = ListBlock([${itemIds.join(", ")}])`);
  stages.forEach((stage, i) => {
    const meta = stage.color ? `cor ${stage.color}` : "stage";
    lines.push(
      `${itemIds[i]} = ListItem("${i + 1}. ${escapeStr(stage.name ?? `Stage ${stage.id}`)}", "${escapeStr(meta)}")`,
    );
  });
  lines.push("followUps = FollowUpBlock([fu1, fu2])");
  lines.push(`fu1 = FollowUpItem("Mostre leads em cada stage")`);
  lines.push(`fu2 = FollowUpItem("Estatísticas de conversão do funnel")`);
  lines.push("```");
  return lines.join("\n");
}

export function invalidateDynamicExamplesCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
