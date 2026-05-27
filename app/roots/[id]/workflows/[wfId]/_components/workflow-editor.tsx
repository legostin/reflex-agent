"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteWorkflowAction,
  listRunsAction,
  runWorkflowAction,
  saveWorkflowAction,
} from "@/lib/server/workflows/actions";
import {
  WORKFLOW_KINDS,
  getKindMeta,
  type WorkflowDef,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowStepKind,
  type WorkflowTrigger,
} from "@/lib/server/workflows/types";

interface Props {
  rootId: string;
  initial: WorkflowDef;
  initialRuns: WorkflowRun[];
}

export function WorkflowEditor({ rootId, initial, initialRuns }: Props) {
  const router = useRouter();
  const [wf, setWf] = useState<WorkflowDef>(initial);
  const [runs, setRuns] = useState<WorkflowRun[]>(initialRuns);
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState<"closed" | "open">("closed");
  const [running, startRun] = useTransition();
  const [saving, startSave] = useTransition();

  const save = (next: WorkflowDef) => {
    setWf(next);
    startSave(async () => {
      const r = await saveWorkflowAction(rootId, next);
      if (!r.ok) toast.error(r.error ?? "Не удалось сохранить");
    });
  };

  const refreshRuns = async () => {
    const r = await listRunsAction(rootId, wf.id);
    if (r.ok) setRuns(r.runs);
  };

  const run = () => {
    startRun(async () => {
      const r = await runWorkflowAction(rootId, wf.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.run.status === "completed") toast.success("Workflow выполнен");
      else if (r.run.status === "failed")
        toast.error("Workflow упал — детали в run history");
      void refreshRuns();
    });
  };

  const onDelete = () => {
    if (!confirm(`Удалить workflow «${wf.label}»? Это необратимо.`)) return;
    startSave(async () => {
      const r = await deleteWorkflowAction(rootId, wf.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      router.push(`/roots/${rootId}/workflows`);
    });
  };

  const addStep = (kind: WorkflowStepKind) => {
    const meta = getKindMeta(kind);
    if (!meta) return;
    const id = uniqueStepId(wf.steps, kind);
    const next: WorkflowDef = {
      ...wf,
      steps: [
        ...wf.steps,
        {
          id,
          kind,
          label: meta.label,
          params: { ...meta.defaultParams },
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    save(next);
    setPicker("closed");
    setEditing(id);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= wf.steps.length) return;
    const steps = [...wf.steps];
    const a = steps[idx]!;
    const b = steps[target]!;
    steps[idx] = b;
    steps[target] = a;
    save({ ...wf, steps, updatedAt: new Date().toISOString() });
  };

  const removeStep = (idx: number) => {
    const steps = wf.steps.filter((_, i) => i !== idx);
    save({ ...wf, steps, updatedAt: new Date().toISOString() });
  };

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    const steps = wf.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    save({ ...wf, steps, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-card p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Название
          </label>
          <Input
            value={wf.label}
            onChange={(e) => save({ ...wf, label: e.target.value })}
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Описание
          </label>
          <Input
            value={wf.description ?? ""}
            onChange={(e) => save({ ...wf, description: e.target.value })}
            className="text-sm"
            placeholder="Что делает workflow"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Триггер
            </label>
            <Select
              value={wf.trigger}
              onValueChange={(v) =>
                save({ ...wf, trigger: v as WorkflowTrigger })
              }
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Вручную</SelectItem>
                <SelectItem value="hourly">Раз в час</SelectItem>
                <SelectItem value="daily">Раз в день</SelectItem>
                <SelectItem value="weekly">Раз в неделю</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {wf.sourceTopicId && (
            <Link
              href={`/roots/${rootId}/chat/${wf.sourceTopicId}`}
              className="text-xs text-muted-foreground hover:underline self-end pb-2"
            >
              Редактировать через топик →
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2 self-end pb-1">
            {saving && (
              <span className="text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                сохранение…
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={saving}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Удалить
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={run}
              disabled={running || wf.steps.length === 0}
              className="gap-1"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Запустить
            </Button>
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Шаги ({wf.steps.length})
        </h2>
        {wf.steps.map((step, idx) => (
          <StepCard
            key={step.id}
            step={step}
            idx={idx}
            total={wf.steps.length}
            editing={editing === step.id}
            onToggleEdit={() =>
              setEditing(editing === step.id ? null : step.id)
            }
            onMoveUp={() => moveStep(idx, -1)}
            onMoveDown={() => moveStep(idx, 1)}
            onRemove={() => removeStep(idx)}
            onChange={(patch) => updateStep(idx, patch)}
          />
        ))}

        {picker === "open" ? (
          <div className="rounded-md border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium">Выбери тип шага</h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPicker("closed")}
                className="h-6 text-xs"
              >
                Отмена
              </Button>
            </div>
            <div className="grid gap-1.5">
              {WORKFLOW_KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => addStep(k.kind)}
                  className="text-left rounded-md border px-3 py-2 hover:bg-accent/60 transition"
                >
                  <div className="text-sm font-medium">{k.label}</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {k.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPicker("open")}
            className="w-full gap-1 border-dashed"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить шаг
          </Button>
        )}
      </section>

      <RunHistory runs={runs} onRefresh={refreshRuns} />
    </div>
  );
}

function StepCard({
  step,
  idx,
  total,
  editing,
  onToggleEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
  onChange,
}: {
  step: WorkflowStep;
  idx: number;
  total: number;
  editing: boolean;
  onToggleEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<WorkflowStep>) => void;
}) {
  const meta = getKindMeta(step.kind);
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 group">
        <span className="text-[10px] font-mono text-muted-foreground w-6 text-center shrink-0">
          {idx + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{step.label}</span>
            <Badge variant="outline" className="text-[10px] font-mono">
              {step.kind}
            </Badge>
          </div>
          {meta && (
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {meta.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onMoveUp}
            disabled={idx === 0}
            className="h-7 w-7"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onMoveDown}
            disabled={idx === total - 1}
            className="h-7 w-7"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onToggleEdit}
            className="h-7 w-7"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onRemove}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="border-t bg-muted/30 px-3 py-3 space-y-2.5">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Label
            </label>
            <Input
              value={step.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          {meta?.fields.map((f) => {
            const value = (step.params[f.key] as string | undefined) ?? "";
            return (
              <div key={f.key} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {f.label}
                </label>
                {f.type === "select" && f.options ? (
                  <Select
                    value={String(value || f.options[0])}
                    onValueChange={(v) =>
                      onChange({ params: { ...step.params, [f.key]: v } })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.type === "text" || f.type === "json" ? (
                  <Textarea
                    value={String(value)}
                    onChange={(e) =>
                      onChange({
                        params: { ...step.params, [f.key]: e.target.value },
                      })
                    }
                    placeholder={f.placeholder}
                    rows={3}
                    className="text-sm font-mono"
                  />
                ) : (
                  <Input
                    value={String(value)}
                    onChange={(e) =>
                      onChange({
                        params: { ...step.params, [f.key]: e.target.value },
                      })
                    }
                    placeholder={f.placeholder}
                    className="h-8 text-sm font-mono"
                  />
                )}
                {f.hint && (
                  <p className="text-[10px] text-muted-foreground">{f.hint}</p>
                )}
              </div>
            );
          })}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onToggleEdit}
              className="h-7 text-xs gap-1"
            >
              <Save className="h-3 w-3" />
              Готово
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RunHistory({
  runs,
  onRefresh,
}: {
  runs: WorkflowRun[];
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, startRefresh] = useTransition();
  if (runs.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          История запусков
        </h2>
        <p className="text-xs text-muted-foreground">Пока пусто.</p>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          История запусков
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => startRefresh(async () => onRefresh())}
          disabled={refreshing}
          className="h-7 text-xs"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            "Обновить"
          )}
        </Button>
      </div>
      <ul className="space-y-1.5">
        {runs.map((r) => (
          <li key={r.id}>
            <details className="rounded-md border bg-card">
              <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2">
                <Badge
                  variant={
                    r.status === "completed"
                      ? "secondary"
                      : r.status === "failed"
                        ? "destructive"
                        : "outline"
                  }
                  className="text-[10px]"
                >
                  {r.status}
                </Badge>
                <span className="text-xs font-mono truncate">{r.id}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {new Date(r.startedAt).toLocaleString()}
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-1.5">
                {r.steps.map((s) => (
                  <div
                    key={s.stepId}
                    className="text-xs rounded border bg-muted/30 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          s.status === "completed"
                            ? "secondary"
                            : s.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                        className="text-[10px]"
                      >
                        {s.status}
                      </Badge>
                      <span className="font-mono">{s.stepId}</span>
                    </div>
                    {s.error && (
                      <pre className="mt-1 text-[10px] text-destructive whitespace-pre-wrap">
                        {s.error}
                      </pre>
                    )}
                    {s.output !== undefined && (
                      <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
                        {previewOutput(s.output)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function previewOutput(v: unknown): string {
  try {
    if (typeof v === "string") return v.length > 800 ? v.slice(0, 800) + "…" : v;
    const j = JSON.stringify(v, null, 2);
    return j.length > 800 ? j.slice(0, 800) + "…" : j;
  } catch {
    return String(v);
  }
}

function uniqueStepId(
  steps: WorkflowStep[],
  kind: WorkflowStepKind,
): string {
  const base = kind.replace(/[^a-z0-9]/gi, "-");
  let i = 1;
  while (steps.some((s) => s.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
