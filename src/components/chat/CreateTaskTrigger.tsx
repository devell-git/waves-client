import { useEffect } from "react";
import { getKanbanCtx } from "../../lib/kanban-context";
import {
  consumeCreateTask,
  wasCreateTaskConsumed,
} from "../../lib/createtask-consumed";

export function parseCreateTaskDirective(
  content: string,
): { workflowId?: number; stageId?: number } | null {
  const t = content.trim();
  if (!t.startsWith("open_create_task")) return null;
  if (t.includes("{") && !t.includes("}")) return null;
  const m = t.match(/\{[\s\S]*\}/);
  let workflowId: number | undefined;
  let stageId: number | undefined;
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { workflow_id?: unknown; stage_id?: unknown };
      if (o.workflow_id != null) workflowId = Number(o.workflow_id);
      if (o.stage_id != null) stageId = Number(o.stage_id);
    } catch {
      /* JSON inválido — usa o contexto do kanban */
    }
  }
  return { workflowId, stageId };
}

export function CreateTaskTrigger({
  directive,
  content,
}: {
  directive: { workflowId?: number; stageId?: number };
  content: string;
}) {
  const wf = directive.workflowId ?? getKanbanCtx().workflowId;
  const st = directive.stageId ?? getKanbanCtx().stageId;
  const fresh = !wasCreateTaskConsumed(content);
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("waves:create-task", {
        detail: { workflowId: wf, stageId: st },
      }),
    );
  useEffect(() => {
    if (wasCreateTaskConsumed(content)) return;
    consumeCreateTask(content);
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="assistant-plain-text"
      style={{ padding: "0.75rem 1rem", opacity: 0.8 }}
    >
      {fresh ? (
        "Abrindo o formulário de nova tarefa…"
      ) : (
        <button
          type="button"
          onClick={open}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "inherit",
            font: "inherit",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Abrir formulário de nova tarefa
        </button>
      )}
    </div>
  );
}
