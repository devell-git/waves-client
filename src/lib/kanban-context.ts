/**
 * Contexto do kanban exibido por último (workflow + etapa inicial).
 *
 * O componente Kanban grava aqui ao renderizar; o handler de criação de task
 * (diretiva `open_create_task`) lê pra saber QUAL workflow abrir no modal —
 * de forma determinística, sem depender do agente inferir o id.
 */
let ctx: { workflowId?: number; stageId?: number } = {};

export function setKanbanCtx(next: { workflowId?: number; stageId?: number }): void {
  if (next.workflowId == null) return;
  ctx = { workflowId: next.workflowId, stageId: next.stageId };
}

export function getKanbanCtx(): { workflowId?: number; stageId?: number } {
  return ctx;
}
