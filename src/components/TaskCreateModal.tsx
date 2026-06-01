import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
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
  createTask,
  getWorkflowMembers,
  getWorkflows,
  getWorkflowStages,
  getWorkflowTaskTypes,
  type Member,
  type Stage,
  type TaskType,
} from "../api/tasks";

/**
 * Modal NATIVO de criação de task (mesmo molde do TaskEditModal — caminho B).
 * Busca etapas/tipos/membros direto na Waves com o token do usuário e cria via
 * POST /tasks — SEM passar pelo LLM (funciona mesmo com o modelo fora do ar).
 */
export function TaskCreateModal({
  open,
  workflowId = null,
  initialStageId,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Workflow pré-selecionado (kanban/AP em contexto). null = mostra seletor. */
  workflowId?: number | null;
  initialStageId?: number | null;
  onClose: () => void;
  onCreated?: (result: {
    id: number | null;
    title: string;
    stageName?: string;
    assigneeName?: string;
    dueDate?: string;
    checklistCount?: number;
  }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<{ id: number; name: string }[]>([]);
  const [selectedWf, setSelectedWf] = useState<number | null>(workflowId);
  const [members, setMembers] = useState<Member[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);

  // Campos
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState<string>("");
  const [stageId, setStageId] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [viewers, setViewers] = useState<number[]>([]);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [doneDate, setDoneDate] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);

  // (A) Ao abrir: reseta o form, define o workflow do preset e carrega a lista
  //     de workflows pro seletor.
  useEffect(() => {
    if (!open) return;
    setSelectedWf(workflowId ?? null);
    setError(null);
    setTitle("");
    setDescription("");
    setAssignedTo("");
    setViewers([]);
    setStartDate("");
    setDueDate("");
    setDoneDate("");
    setChecklist([]);
    let cancelled = false;
    getWorkflows()
      .then((w) => {
        if (!cancelled) setWorkflows(w);
      })
      .catch(() => {
        /* lista do seletor é best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [open, workflowId]);

  // (B) Quando o workflow selecionado muda: carrega etapas/tipos/membros dele.
  useEffect(() => {
    if (selectedWf == null) {
      setStages([]);
      setTypes([]);
      setMembers([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAssignedTo("");
    setViewers([]);
    (async () => {
      try {
        const [mem, stg, typ] = await Promise.all([
          getWorkflowMembers(selectedWf),
          getWorkflowStages(selectedWf),
          getWorkflowTaskTypes(selectedWf),
        ]);
        if (cancelled) return;
        setMembers(mem);
        setStages(stg);
        setTypes(typ);
        setTypeId(typ[0] ? String(typ[0].id) : "");
        setStageId(
          initialStageId != null
            ? String(initialStageId)
            : stg[0]
              ? String(stg[0].id)
              : "",
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar o workflow.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWf, initialStageId]);

  const toggleViewer = (id: number) =>
    setViewers((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const setItem = (i: number, val: string) =>
    setChecklist((cl) => cl.map((c, idx) => (idx === i ? val : c)));
  const addItem = () => setChecklist((cl) => [...cl, ""]);
  const removeItem = (i: number) => setChecklist((cl) => cl.filter((_, idx) => idx !== i));

  const handleCreate = async () => {
    if (selectedWf == null) {
      setError("Selecione o workflow.");
      return;
    }
    if (!title.trim()) {
      setError("Título é obrigatório.");
      return;
    }
    if (!stageId) {
      setError("Selecione a etapa.");
      return;
    }
    if (!typeId) {
      setError("Selecione o tipo da tarefa.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const items = checklist.map((c) => c.trim()).filter(Boolean);
      const id = await createTask({
        workflow_id: selectedWf,
        funnel_stage_id: Number(stageId),
        task_type_id: Number(typeId),
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assignedTo ? { assigned_to: Number(assignedTo) } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(doneDate ? { done_date: doneDate } : {}),
        ...(items.length ? { checklist: items } : {}),
        ...(viewers.length ? { visible_to_users: viewers } : {}),
      });
      onCreated?.({
        id,
        title: title.trim(),
        stageName: stages.find((s) => String(s.id) === stageId)?.name,
        assigneeName: assignedTo
          ? members.find((m) => String(m.id) === assignedTo)?.name
          : undefined,
        dueDate: dueDate || undefined,
        checklistCount: items.length,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao criar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>
            Criada direto na Waves. Preencha os campos e crie.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field label="Workflow">
            <select
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedWf != null ? String(selectedWf) : ""}
              onChange={(e) => setSelectedWf(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— selecione o workflow —</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {selectedWf == null ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Selecione um workflow para continuar.
          </div>
        ) : loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-4 py-2">
            <Field label="Título">
              <input
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Revisar protocolo X"
              />
            </Field>

            <Field label="Descrição">
              <textarea
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[64px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <select
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                >
                  {types.length === 0 && <option value="">— sem tipos —</option>}
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
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
            </div>

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
                <input
                  type="date"
                  className="w-full rounded-md border border-input bg-transparent px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="Prazo">
                <input
                  type="date"
                  className="w-full rounded-md border border-input bg-transparent px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
              <Field label="Concluído">
                <input
                  type="date"
                  className="w-full rounded-md border border-input bg-transparent px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={doneDate}
                  onChange={(e) => setDoneDate(e.target.value)}
                />
              </Field>
            </div>

            <Collapsible
              label="Checklist"
              badge={checklist.length ? `${checklist.length} ${checklist.length === 1 ? "item" : "itens"}` : undefined}
              defaultOpen={checklist.length > 0}
            >
              <div className="space-y-2">
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={item}
                      placeholder={`Item ${i + 1}`}
                      onChange={(e) => setItem(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remover item"
                      onClick={() => removeItem(i)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  onClick={addItem}
                >
                  <Plus className="h-4 w-4" /> Adicionar item
                </button>
              </div>
            </Collapsible>

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={loading || saving || selectedWf == null}>
            {saving ? "Criando…" : "Criar tarefa"}
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
