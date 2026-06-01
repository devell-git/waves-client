"use client";

import { defineComponent } from "@openuidev/react-lang";
import { Plus } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { moveTask } from "../../../api/tasks";
import { setKanbanCtx } from "../../kanban-context";

// ─────────────────────────────────────────────────────────────────
// WorkflowKanban — board data-driven (fluxo EXECUTE, sem LLM).
//
// Recebe `data` = saída de Query("get_workflow_kanban", {id}). Mapeia
// stages→colunas e tasks→cards internamente (o agente NÃO precisa saber os
// nomes dos campos). Drag entre etapas (POST /tasks/:id/move), clique no card
// abre o modal de edição, "+ Nova" abre o de criação. Tudo sem voltar ao LLM.

// Leitura defensiva (os campos variam um pouco conforme a versão da Waves).
function pick(o: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}
function asNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

interface CardModel {
  id?: number;
  title: string;
  responsibleName?: string;
  responsibleAvatar?: string;
  progress?: number;
  badges: string[];
  tags: string[];
}
interface ColModel {
  stageId?: number;
  name: string;
  color?: string;
  count?: number;
  cards: CardModel[];
}

function mapTask(t: Record<string, unknown>): CardModel {
  const resp = (pick(t, ["responsible"]) as Record<string, unknown>) || {};
  const itemsCount = asNum(pick(t, ["items_count"]));
  const itemsDone = asNum(pick(t, ["items_completed", "items_done"]));
  const progress =
    itemsCount && itemsCount > 0 && itemsDone != null
      ? Math.round((itemsDone / itemsCount) * 100)
      : asNum(pick(t, ["progress"]));
  const taskType = pick(t, ["task_type"]) as Record<string, unknown> | undefined;
  const badge = pick(t, ["time_in_current_stage", "time_in_stage"]);
  return {
    id: asNum(pick(t, ["id"])),
    title: String(pick(t, ["title", "name"]) ?? "(sem título)"),
    responsibleName:
      (pick(resp, ["name"]) as string) ?? (pick(t, ["responsible_name"]) as string),
    responsibleAvatar:
      (pick(resp, ["avatar", "avatar_url"]) as string) ??
      (pick(t, ["responsible_avatar"]) as string),
    progress,
    badges: badge ? [String(badge)] : [],
    tags: taskType?.name ? [String(taskType.name)] : [],
  };
}

function mapData(data: unknown): { workflowId?: number; cols: ColModel[] } {
  const d = (data ?? {}) as Record<string, unknown>;
  const wf = (pick(d, ["workflow"]) as Record<string, unknown>) || {};
  const workflowId = asNum(pick(wf, ["id"]));
  const stages = (pick(d, ["stages"]) as Array<Record<string, unknown>>) || [];
  const cols: ColModel[] = (Array.isArray(stages) ? stages : []).map((s) => ({
    stageId: asNum(pick(s, ["id"])),
    name: String(pick(s, ["name"]) ?? "Etapa"),
    color: pick(s, ["color"]) as string | undefined,
    count: asNum(pick(s, ["tasks_count"])),
    cards: ((pick(s, ["tasks"]) as Array<Record<string, unknown>>) || []).map(mapTask),
  }));
  return { workflowId, cols };
}

const DND_MIME = "application/x-waves-task";

export const WorkflowKanban = defineComponent({
  name: "WorkflowKanban",
  props: z.object({
    // `data` vem de Query("get_workflow_kanban", {id}). z.any() porque é o
    // resultado do runtime (RuntimeRef), não um literal.
    data: z.any(),
  }),
  description:
    "Board Kanban DATA-DRIVEN (fluxo EXECUTE, sem LLM). Recebe `data` de " +
    'Query("get_workflow_kanban", {id: <workflow_id>}, {stages: []}) e monta o ' +
    "board sozinho (stages→colunas, tasks→cards, com drag, edição e + Nova). " +
    "Use SEMPRE este componente para kanban de workflow — NÃO monte Kanban/" +
    "KanbanColumn/KanbanCard à mão com dados buscados. Padrão: " +
    '`kb = Query("get_workflow_kanban", {id: 57}, {stages: []})` e ' +
    "`board = WorkflowKanban(kb)`.",
  component: ({ props }) => {
    const { workflowId, cols } = mapData(props.data);

    React.useEffect(() => {
      if (workflowId != null) setKanbanCtx({ workflowId });
    }, [workflowId]);

    // DnD otimista (espelha kanban.tsx): card some da origem, chip na coluna alvo.
    const [movedAway, setMovedAway] = React.useState<Set<number>>(() => new Set());
    const [movedIn, setMovedIn] = React.useState<Map<number, CardModel>>(
      () => new Map(),
    );
    const [overStage, setOverStage] = React.useState<number | null>(null);

    const onDropCard = (targetStageId: number, card: CardModel) => {
      if (card.id == null) return;
      setMovedAway((s) => new Set(s).add(card.id!));
      setMovedIn((m) => new Map(m).set(card.id!, card));
      moveTask(card.id, targetStageId).catch((err) => {
        console.error("[wf-kanban] move falhou:", err);
        setMovedAway((s) => {
          const n = new Set(s);
          n.delete(card.id!);
          return n;
        });
        setMovedIn((m) => {
          const n = new Map(m);
          n.delete(card.id!);
          return n;
        });
      });
    };

    if (cols.length === 0) {
      return <div className="text-xs text-muted-foreground py-4">Kanban vazio.</div>;
    }

    return (
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {cols.map((col, ci) => {
          const droppable = col.stageId != null;
          const incoming = [...movedIn.values()].filter(
            (c) => col.stageId != null && c.id != null,
          );
          // cards que vieram pra esta coluna (movedIn aponta pro destino)
          return (
            <div
              key={col.stageId ?? ci}
              className="flex flex-col min-w-[260px] max-w-[300px] bg-muted/40 rounded-lg overflow-hidden flex-shrink-0"
            >
              <div
                className="px-3 py-2 border-b bg-background/60 backdrop-blur"
                style={col.color ? { borderTop: `3px solid ${col.color}` } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">{col.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {typeof col.count === "number" && (
                      <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                        {col.count}
                      </span>
                    )}
                    {workflowId != null && col.stageId != null && (
                      <button
                        type="button"
                        title="Nova tarefa nesta etapa"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("waves:create-task", {
                              detail: { workflowId, stageId: col.stageId },
                            }),
                          )
                        }
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 overflow-y-auto p-2 space-y-2 max-h-[600px] transition-colors ${
                  overStage === col.stageId ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""
                }`}
                onDragOver={
                  droppable
                    ? (e) => {
                        e.preventDefault();
                        if (overStage !== col.stageId) setOverStage(col.stageId!);
                      }
                    : undefined
                }
                onDragLeave={droppable ? () => setOverStage(null) : undefined}
                onDrop={
                  droppable
                    ? (e) => {
                        e.preventDefault();
                        setOverStage(null);
                        try {
                          const card = JSON.parse(
                            e.dataTransfer.getData(DND_MIME),
                          ) as CardModel;
                          onDropCard(col.stageId!, card);
                        } catch {
                          /* ignora */
                        }
                      }
                    : undefined
                }
              >
                {col.cards.filter((c) => !(c.id != null && movedAway.has(c.id))).length ===
                  0 && incoming.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-4">Sem tasks</div>
                ) : (
                  <>
                    {col.cards
                      .filter((c) => !(c.id != null && movedAway.has(c.id)))
                      .map((card, idx) => (
                        <CardView
                          key={card.id ?? idx}
                          card={card}
                          draggable={card.id != null}
                        />
                      ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  },
});

function CardView({ card, draggable }: { card: CardModel; draggable: boolean }) {
  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(DND_MIME, JSON.stringify(card));
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      onClick={
        card.id != null
          ? () =>
              window.dispatchEvent(
                new CustomEvent("waves:edit-task", { detail: { taskId: card.id } }),
              )
          : undefined
      }
      className={`rounded-md border bg-card p-2.5 shadow-sm space-y-2 transition-colors ${
        card.id != null ? "cursor-pointer hover:bg-accent/50" : ""
      } ${draggable ? "active:opacity-60" : ""}`}
    >
      {card.badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.badges.map((b, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-muted text-foreground"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="text-sm font-medium leading-snug">{card.title}</div>
      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.tags.map((t, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full border bg-background">
              {t}
            </span>
          ))}
        </div>
      )}
      {typeof card.progress === "number" && (
        <div className="space-y-0.5">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, Math.max(0, card.progress))}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground text-right">
            {Math.round(card.progress)}%
          </div>
        </div>
      )}
      {card.responsibleName && (
        <div className="flex items-center gap-1.5 pt-1 border-t">
          {card.responsibleAvatar ? (
            <img
              src={card.responsibleAvatar}
              alt={card.responsibleName}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">
              {card.responsibleName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-xs text-muted-foreground truncate">{card.responsibleName}</span>
        </div>
      )}
    </div>
  );
}
