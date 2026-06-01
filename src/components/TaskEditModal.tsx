import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  getTaskForEdit,
  getWorkflowMembers,
  getWorkflowStages,
  toggleChecklistItem,
  updateTask,
  type ChecklistItem,
  type TaskEditData,
  type Member,
  type Stage,
} from "../api/tasks";

/** Bloco colapsável simples (fechado por padrão). */
function Collapsible({
  label,
  badge,
  defaultOpen = false,
  children,
}: {
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-input">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-muted-foreground">
          {label}
          {badge ? <span className="ml-1.5 text-xs opacity-70">{badge}</span> : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t px-3 py-2">{children}</div>}
    </div>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
}

/**
 * Modal NATIVO de edição de task (caminho B). Ao abrir (taskId != null), faz um
 * GET dos dados REAIS (task + membros + etapas) com o token do usuário, mostra o
 * form JÁ PREENCHIDO e salva via PUT — sem passar pelo LLM (rápido e confiável).
 */
export function TaskEditModal({
  taskId,
  onClose,
  onSaved,
}: {
  taskId: number | null;
  onClose: () => void;
  onSaved?: (result: { id: number; title: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [orig, setOrig] = useState<TaskEditData | null>(null);

  // Campos editáveis
  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [viewers, setViewers] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState<string>("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (taskId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const t = await getTaskForEdit(taskId);
        const [mem, stg] = await Promise.all([
          getWorkflowMembers(t.workflowId),
          getWorkflowStages(t.workflowId),
        ]);
        if (cancelled) return;
        setOrig(t);
        setMembers(mem);
        setStages(stg);
        setTitle(t.title);
        setStageId(t.funnelStageId != null ? String(t.funnelStageId) : "");
        setAssignedTo(t.assignedTo != null ? String(t.assignedTo) : "");
        setViewers(t.visibleToUserIds);
        setDueDate(t.dueDate ?? "");
        setChecklist(t.checklist);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar a task.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const toggleViewer = (id: number) =>
    setViewers((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  // Checklist: toggle otimista + persiste; reverte se a API falhar.
  const toggleItem = async (item: ChecklistItem) => {
    if (!orig || !item.id) return;
    setChecklist((cl) =>
      cl.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
    );
    try {
      await toggleChecklistItem(orig.id, item.id);
    } catch {
      setChecklist((cl) =>
        cl.map((c) => (c.id === item.id ? { ...c, done: item.done } : c)),
      );
    }
  };

  const handleSave = async () => {
    if (!orig) return;
    const patch: Record<string, unknown> = {};
    if (title.trim() && title !== orig.title) patch.title = title.trim();
    if (stageId && Number(stageId) !== orig.funnelStageId) patch.funnel_stage_id = Number(stageId);
    if (assignedTo && Number(assignedTo) !== orig.assignedTo) patch.assigned_to = Number(assignedTo);
    if (dueDate && dueDate !== orig.dueDate) patch.due_date = dueDate;
    const sameViewers =
      viewers.length === orig.visibleToUserIds.length &&
      viewers.every((id) => orig.visibleToUserIds.includes(id));
    if (!sameViewers) patch.visible_to_users = viewers;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateTask(orig.id, patch);
      onSaved?.({ id: orig.id, title: title.trim() || orig.title });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={taskId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar tarefa{orig ? ` #${orig.id}` : ""}</DialogTitle>
          <DialogDescription>
            Dados carregados direto da Waves. Mude só o que precisar e salve.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : error && !orig ? (
          <div className="py-6 text-center text-sm text-destructive">{error}</div>
        ) : (
          <div className="space-y-4 py-2">
            <Field label="Título">
              <input
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            <Field label="Etapa">
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Responsável">
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">— ninguém —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>

            <Collapsible label="Visualizadores" badge={`${viewers.length} selec.`}>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {members
                  .filter((m) => String(m.id) !== assignedTo)
                  .map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={viewers.includes(m.id)}
                        onChange={() => toggleViewer(m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
              </div>
            </Collapsible>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Início">
                <div className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {fmtDate(orig?.startedAt ?? null)}
                </div>
              </Field>
              <Field label="Concluído">
                <div className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {fmtDate(orig?.completedAt ?? null)}
                </div>
              </Field>
              <Field label="Prazo">
                <input
                  type="date"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            </div>

            {checklist.length > 0 && (
              <Collapsible
                label="Checklist"
                badge={`${checklist.filter((c) => c.done).length}/${checklist.length}`}
              >
                <div className="space-y-1.5">
                  {checklist.map((item, i) => (
                    <label
                      key={item.id || i}
                      className="flex items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={item.done}
                        disabled={!item.id}
                        onChange={() => toggleItem(item)}
                      />
                      <span className={item.done ? "line-through text-muted-foreground" : ""}>
                        {item.text}
                      </span>
                    </label>
                  ))}
                </div>
              </Collapsible>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || !orig}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
