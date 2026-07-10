import { getKanbanCtx } from "../../lib/kanban-context";
import { resolveWorkflowIdByLabel } from "../../lib/openui-tools";

function escOL(s: string): string {
  return String(s).replace(/[\r\n]+/g, " ").replace(/[\\"]/g, "'").slice(0, 120);
}
function fmtBR(d?: string): string | undefined {
  if (!d) return undefined;
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
}
export interface TaskFeedback {
  id: number | null;
  title: string;
  stageName?: string;
  assigneeName?: string;
  dueDate?: string;
  checklistCount?: number;
}
function buildTaskCard(variant: "created" | "updated", r: TaskFeedback): string {
  const header = variant === "created" ? "✅ Tarefa criada" : "✏️ Tarefa atualizada";
  const sub = `${r.id != null ? `#${r.id} — ` : ""}${escOL(r.title)}`;
  const defs: string[] = [];
  const refs: string[] = [];
  const addTag = (label: string, v: string) => {
    const name = `tg${refs.length + 1}`;
    refs.push(name);
    defs.push(`${name} = Tag("${escOL(label)}", "${v}")`);
  };
  if (r.stageName) addTag(`Etapa: ${r.stageName}`, "secondary");
  if (r.assigneeName) addTag(`Resp.: ${r.assigneeName}`, "outline");
  const due = fmtBR(r.dueDate);
  if (due) addTag(`Prazo: ${due}`, "default");
  if (r.checklistCount && r.checklistCount > 0) {
    addTag(`Checklist: ${r.checklistCount} ${r.checklistCount === 1 ? "item" : "itens"}`, "outline");
  }
  const lines = [
    `root = Card([h${refs.length ? ", tags" : ""}])`,
    `h = CardHeader("${header}", "${sub}")`,
  ];
  if (refs.length) {
    lines.push(`tags = TagBlock([${refs.join(", ")}])`);
    lines.push(...defs);
  }
  return lines.join("\n");
}
export function appendTaskCard(variant: "created" | "updated", r: TaskFeedback): void {
  window.dispatchEvent(
    new CustomEvent("waves:chat-append", { detail: { content: buildTaskCard(variant, r) } }),
  );
}

const OPEN_KANBAN_INTENT =
  /^\s*(abrir?|abra|mostr(?:ar|e|a)|ver|exib(?:ir|a|e)|carreg(?:ar|a|ue)|ir\s+(?:pra|para|ao|à))\b[^.?!]{0,30}\bkanban\b/i;
const OPEN_GANTT_INTENT =
  /^\s*(?:(?:abrir?|abra|mostr(?:ar|e|a)|ver|exib(?:ir|a|e)|gerar?|gere|criar?|crie|montar?|monte|quero|preciso)\b[^.?!]{0,24}\s+)?(gantt|cronograma|linha\s+do\s+tempo|timeline)\b/i;
const PROJECT_GANTT_QUALIFIER =
  /\b(geral|do\s+projeto|projeto\s+inteiro|de\s+todos|todos\s+os\s+ap|portf[óo]lio|portfolio)\b/i;
const AP_LABEL =
  /\b(?:ap|action\s*plan|workflow|wf)\s*#?\s*(\d+(?:\.\d+)?)|(?:kanban|gantt|cronograma|timeline)\s+(?:do|da|de|no|pra|para|pro)?\s*#?\s*(\d+(?:\.\d+)?)/i;

function buildKanbanOpenui(workflowId: number, label: string, name?: string): string {
  const sub = name ? escOL(name) : "Quadro ao vivo · arraste cards, clique pra editar";
  return [
    `root = Card([header, board])`,
    `header = CardHeader("Kanban — AP ${escOL(label)}", "${sub}")`,
    `kb = Query("get_workflow_kanban", {id: ${workflowId}}, {stages: []})`,
    `board = WorkflowKanban(kb)`,
  ].join("\n");
}

function buildGanttOpenui(workflowId: number, label: string, name?: string): string {
  const sub = name ? escOL(name) : "Cronograma ao vivo · barras por prazo, clique pra editar";
  return [
    `root = Card([header, gantt])`,
    `header = CardHeader("Cronograma — AP ${escOL(label)}", "${sub}")`,
    `g = Query("get_workflow_gantt", {workflow_id: ${workflowId}}, {rows: []})`,
    `gantt = WorkflowGantt(g)`,
  ].join("\n");
}

function buildProjectGanttOpenui(): string {
  return [
    `root = Card([header, gantt])`,
    `header = CardHeader("Cronograma do projeto", "Todos os workflows · expanda pra ver tarefas e subtarefas")`,
    `pg = Query("get_project_gantt", {}, {workflows: []})`,
    `gantt = ProjectGantt(pg)`,
  ].join("\n");
}

export function syntheticSse(content: string): Response {
  const enc = new TextEncoder();
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id: `chatcmpl-local-${crypto.randomUUID()}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk({ content }, null));
      controller.enqueue(chunk({}, "stop"));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

export async function tryWorkflowViewShortcut(text: string): Promise<string | null> {
  if (!text) return null;
  const isGantt = OPEN_GANTT_INTENT.test(text);
  const isKanban = !isGantt && OPEN_KANBAN_INTENT.test(text);
  if (!isGantt && !isKanban) return null;
  if (isGantt && PROJECT_GANTT_QUALIFIER.test(text)) return buildProjectGanttOpenui();
  const m = text.match(AP_LABEL);
  const label = m?.[1] ?? m?.[2];
  let workflowId: number | undefined;
  let resolvedName: string | undefined;
  let shownLabel = label;
  try {
    if (label) {
      const res = await resolveWorkflowIdByLabel(label);
      if (res) {
        workflowId = res.id;
        resolvedName = res.name;
      }
    } else {
      const ctx = getKanbanCtx().workflowId;
      if (ctx != null) {
        workflowId = ctx;
        shownLabel = String(ctx);
      }
    }
  } catch {
    return null;
  }
  if (workflowId == null) return null;
  const lbl = shownLabel ?? String(workflowId);
  return isGantt
    ? buildGanttOpenui(workflowId, lbl, resolvedName)
    : buildKanbanOpenui(workflowId, lbl, resolvedName);
}
