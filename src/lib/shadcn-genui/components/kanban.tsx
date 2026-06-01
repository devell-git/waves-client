"use client";

import {
  defineComponent,
  BuiltinActionType,
  useTriggerAction,
} from "@openuidev/react-lang";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { Avatar } from "./avatar";
import { Progress } from "./progress";
import { ShadcnBadgeComponent } from "./badge";
import { actionSchema, type ActionSchema } from "../action";
import { moveTask } from "../../../api/tasks";

// ─────────────────────────────────────────────────────────────────
// Drag-and-drop context — provido pelo Kanban, consumido por colunas/cards.
//
// O card se auto-esconde quando movido (lê `movedAway` pelo próprio taskId);
// a coluna alvo renderiza um chip leve com o snapshot do card movido
// (`movedIn[stageId]`). A persistência é via POST /tasks/:id/move. Em erro,
// reverte (o card volta pra origem — "snap back").

interface CardSnapshot {
  taskId: number;
  title: string;
  responsibleName?: string;
}
interface KanbanDnd {
  enabled: boolean;
  movedAway: Set<number>;
  movedIn: Map<number, CardSnapshot[]>;
  onDrop: (targetStageId: number, snap: CardSnapshot) => void;
}
const KanbanDndContext = React.createContext<KanbanDnd | null>(null);

const DND_MIME = "application/x-waves-task";

// ─────────────────────────────────────────────────────────────────
// KanbanCard — uma task individual num column

const KanbanCardSchema = z.object({
  title: z.string(),
  badges: z.array(z.string()).optional(),
  progress: z.number().min(0).max(100).optional(),
  responsibleName: z.string().optional(),
  responsibleAvatar: z.string().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  id: z.string().optional(),
  // Conteúdo opcional que aparece embaixo do card quando expandido (click no card).
  // Usa z.any() pra evitar ciclo com unions.ts.
  expandable: z.array(z.any()).optional(),
  // Torna o CARD INTEIRO clicável (ex.: pra editar a task). Mesmo schema do
  // Button. Use `{type:'continue_conversation', context:'Editar task 651'}` —
  // o `context` vira a mensagem enviada ao agente ao clicar.
  action: actionSchema,
});

export const KanbanCard = defineComponent({
  name: "KanbanCard",
  props: KanbanCardSchema,
  description:
    "Card de uma task individual no Kanban. title obrigatório. " +
    "🔑 SEMPRE inclua `id` = o id da task (ex.: id=\"651\") — um card com id vira " +
    "CLICÁVEL (abre o modal de edição) e ARRASTÁVEL entre colunas (drag-and-drop). " +
    "NUNCA omita o id. badges: pequenos rótulos no topo (ex.: ['15d 6h']). progress: 0-100. " +
    "responsibleName/Avatar: pessoa responsável. tags: rótulos coloridos. " +
    "expandable (opcional): array de componentes que aparece embaixo do card.",
  component: ({ props, renderNode }) => {
    const badges = (props.badges ?? []) as string[];
    const tags = (props.tags ?? []) as string[];
    const progress = props.progress as number | undefined;
    const responsibleName = props.responsibleName as string | undefined;
    const responsibleAvatar = props.responsibleAvatar as string | undefined;
    const expandable = (props.expandable ?? []) as unknown[];
    const hasExpandable = expandable.length > 0;
    const [open, setOpen] = React.useState(false);

    const triggerAction = useTriggerAction();
    const action = props.action as ActionSchema | undefined;
    const hasAction = !!action;
    // Task id = id da task → card vira editável (clique abre o modal nativo).
    // O agente às vezes erra a posição do `id` e ele cai em `status` (que normal
    // seria "To Do"/"In Progress", não um número) — então aceitamos id numérico
    // vindo de `id` OU de `status`. Assim o agente só precisa incluir o número.
    const numeric = (v: unknown): string | undefined =>
      typeof v === "string" && /^\d+$/.test(v.trim()) ? v.trim() : undefined;
    const taskId = numeric(props.id) ?? numeric(props.status);
    const autoEditable = !hasAction && !hasExpandable && !!taskId;

    const dnd = React.useContext(KanbanDndContext);
    const taskIdNum = taskId ? Number(taskId) : undefined;
    const draggable = !!(dnd?.enabled && taskIdNum);

    // Se foi movido pra outra coluna, some daqui (a coluna alvo mostra o chip).
    if (dnd && taskIdNum && dnd.movedAway.has(taskIdNum)) {
      return null;
    }

    // Clique no card: ação explícita > auto-editar (id) > expandir.
    const handleCardClick = () => {
      if (hasAction) {
        const actionType = action?.type ?? BuiltinActionType.ContinueConversation;
        if (actionType === BuiltinActionType.OpenUrl) {
          triggerAction(String(props.title ?? ""), undefined, {
            type: actionType,
            params: { url: (action as { url?: string }).url },
          });
          return;
        }
        // continue_conversation OU custom (ex.: edit_task): repassa o `context`
        // como mensagem e os `params` (ex.: {task_id}) pro onAction.
        const params = (action as { params?: Record<string, unknown> })?.params;
        const msg =
          (action as { context?: string })?.context || String(props.title ?? "task");
        triggerAction(msg, undefined, { type: actionType, params });
      } else if (autoEditable) {
        triggerAction(`Editar task ${taskId}`, undefined, {
          type: "edit_task",
          params: { task_id: Number(taskId) },
        });
      } else if (hasExpandable) {
        setOpen((v) => !v);
      }
    };
    const clickable = hasAction || autoEditable || hasExpandable;

    return (
      <div
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                const snap: CardSnapshot = {
                  taskId: taskIdNum!,
                  title: String(props.title ?? ""),
                  responsibleName,
                };
                e.dataTransfer.setData(DND_MIME, JSON.stringify(snap));
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        className={`rounded-md border bg-card p-2.5 shadow-sm space-y-2 transition-colors ${
          clickable ? "cursor-pointer hover:bg-accent/50" : ""
        } ${draggable ? "active:opacity-60" : ""}`}
        onClick={clickable ? handleCardClick : undefined}
      >
        {(badges.length > 0 || hasExpandable) && (
          <div className="flex items-start justify-between gap-1">
            <div className="flex flex-wrap gap-1 flex-1">
              {badges.map((b, i) => (
                <span
                  key={i}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-muted text-foreground"
                >
                  {b}
                </span>
              ))}
            </div>
            {hasExpandable && (
              <ChevronDown
                className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform mt-1 ${
                  open ? "rotate-180" : ""
                }`}
              />
            )}
          </div>
        )}
        <div className="text-sm font-medium leading-snug">{String(props.title)}</div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded-full border bg-background"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {typeof progress === "number" && (
          <div className="space-y-0.5">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground text-right">{Math.round(progress)}%</div>
          </div>
        )}
        {responsibleName && (
          <div className="flex items-center gap-1.5 pt-1 border-t">
            {responsibleAvatar ? (
              <img
                src={responsibleAvatar}
                alt={responsibleName}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">
                {responsibleName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-xs text-muted-foreground truncate">{responsibleName}</span>
          </div>
        )}
        {hasExpandable && open && (
          <div
            className="border-t pt-2 mt-2 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {renderNode(expandable)}
          </div>
        )}
      </div>
    );
  },
});

// Chip leve que representa um card movido pra esta coluna (otimista).
function MovedInChip({ snap }: { snap: CardSnapshot }) {
  return (
    <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 p-2.5 shadow-sm space-y-1">
      <div className="text-sm font-medium leading-snug">{snap.title}</div>
      <div className="flex items-center gap-1 text-[10px] text-primary">
        <span>✓ movida para cá</span>
      </div>
      {snap.responsibleName && (
        <div className="text-xs text-muted-foreground truncate">{snap.responsibleName}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// KanbanColumn — uma coluna (stage) com header + cards

const KanbanColumnSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  count: z.number().optional(),
  cards: z.array(KanbanCard.ref),
  // 🔑 stageId = funnel_stage_id da etapa. Necessário pra DRAG-AND-DROP:
  // soltar um card aqui move a task pra esta etapa. Vem DEPOIS de cards
  // (último posicional) pra não quebrar `KanbanColumn(name, color, count, cards)`.
  stageId: z.union([z.string(), z.number()]).optional(),
});

export const KanbanColumn = defineComponent({
  name: "KanbanColumn",
  props: KanbanColumnSchema,
  description:
    "Coluna do Kanban (um stage). name: nome da coluna; color: hex (#dc3545) para borda " +
    "superior; count: número de tasks; cards: array de KanbanCard. " +
    "🔑 stageId = funnel_stage_id desta etapa — inclua SEMPRE para habilitar arrastar " +
    "cards entre colunas (drag-and-drop move a task pra etapa onde foi solta).",
  component: ({ props, renderNode }) => {
    const cards = (props.cards ?? []) as unknown[];
    const color = props.color as string | undefined;
    const count = props.count as number | undefined;
    const stageIdRaw = props.stageId as string | number | undefined;
    const stageId =
      stageIdRaw != null && /^\d+$/.test(String(stageIdRaw))
        ? Number(stageIdRaw)
        : undefined;

    const dnd = React.useContext(KanbanDndContext);
    const [over, setOver] = React.useState(false);
    const droppable = !!(dnd?.enabled && stageId != null);
    const movedIn = (stageId != null && dnd?.movedIn.get(stageId)) || [];

    const onDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (!droppable) return;
      const raw = e.dataTransfer.getData(DND_MIME);
      if (!raw) return;
      try {
        const snap = JSON.parse(raw) as CardSnapshot;
        dnd!.onDrop(stageId!, snap);
      } catch {
        /* ignora payload inválido */
      }
    };

    return (
      <div className="flex flex-col min-w-[260px] max-w-[300px] bg-muted/40 rounded-lg overflow-hidden flex-shrink-0">
        <div
          className="px-3 py-2 border-b bg-background/60 backdrop-blur"
          style={color ? { borderTop: `3px solid ${color}` } : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold truncate">{String(props.name)}</span>
            {typeof count === "number" && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {count}
              </span>
            )}
          </div>
        </div>
        <div
          className={`flex-1 overflow-y-auto p-2 space-y-2 max-h-[600px] transition-colors ${
            over ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""
          }`}
          onDragOver={
            droppable
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (!over) setOver(true);
                }
              : undefined
          }
          onDragLeave={droppable ? () => setOver(false) : undefined}
          onDrop={droppable ? onDrop : undefined}
        >
          {cards.length === 0 && movedIn.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              {droppable && over ? "Solte aqui" : "Sem tasks"}
            </div>
          ) : (
            <>
              {renderNode(cards)}
              {movedIn.map((snap) => (
                <MovedInChip key={`moved-${snap.taskId}`} snap={snap} />
              ))}
            </>
          )}
        </div>
      </div>
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// Kanban — container root horizontal com scroll

const KanbanSchema = z.object({
  columns: z.array(KanbanColumn.ref),
  title: z.string().optional(),
});

export const Kanban = defineComponent({
  name: "Kanban",
  props: KanbanSchema,
  description:
    "Board Kanban (estilo Trello/Jira). columns: array de KanbanColumn em layout horizontal " +
    "com scroll. title: cabeçalho opcional acima do board. Use para visualizar tasks " +
    "agrupadas por stage/status. Inclua `id` em cada KanbanCard e `stageId` em cada " +
    "KanbanColumn para habilitar arrastar tasks entre etapas. NÃO use Stack(horizontal) " +
    "pra simular kanban — use este componente.",
  component: ({ props, renderNode }) => {
    const columns = (props.columns ?? []) as unknown[];
    const title = props.title as string | undefined;

    // Estado de DnD do board (otimista + persistência via /move).
    const [movedAway, setMovedAway] = React.useState<Set<number>>(() => new Set());
    const [movedIn, setMovedIn] = React.useState<Map<number, CardSnapshot[]>>(
      () => new Map(),
    );

    const onDrop = React.useCallback(
      (targetStageId: number, snap: CardSnapshot) => {
        // Otimista: some da origem, aparece na coluna alvo.
        setMovedAway((s) => new Set(s).add(snap.taskId));
        setMovedIn((m) => {
          const next = new Map(m);
          // remove de qualquer coluna anterior (re-drag) e adiciona na nova
          for (const [k, arr] of next) {
            const f = arr.filter((c) => c.taskId !== snap.taskId);
            if (f.length) next.set(k, f);
            else next.delete(k);
          }
          next.set(targetStageId, [...(next.get(targetStageId) ?? []), snap]);
          return next;
        });
        // Persiste; em erro, reverte (snap back).
        moveTask(snap.taskId, targetStageId).catch((err) => {
          console.error("[kanban] falha ao mover task:", err);
          setMovedAway((s) => {
            const n = new Set(s);
            n.delete(snap.taskId);
            return n;
          });
          setMovedIn((m) => {
            const next = new Map(m);
            const arr = (next.get(targetStageId) ?? []).filter(
              (c) => c.taskId !== snap.taskId,
            );
            if (arr.length) next.set(targetStageId, arr);
            else next.delete(targetStageId);
            return next;
          });
        });
      },
      [],
    );

    const dnd: KanbanDnd = { enabled: true, movedAway, movedIn, onDrop };

    return (
      <KanbanDndContext.Provider value={dnd}>
        <div className="space-y-2">
          {title && <div className="text-sm font-semibold px-1">{title}</div>}
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {columns.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">Kanban vazio.</div>
            ) : (
              renderNode(columns)
            )}
          </div>
        </div>
      </KanbanDndContext.Provider>
    );
  },
});

// Re-exports pra evitar "unused" warning no helpers se forem usados
void Avatar;
void Progress;
void ShadcnBadgeComponent;
