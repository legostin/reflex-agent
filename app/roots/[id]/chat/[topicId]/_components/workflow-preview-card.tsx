"use client";

import Link from "next/link";
import {
  ArrowRight,
  Pencil,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  rootId: string;
  workflow: {
    workflowId: string;
    label: string;
    description?: string;
    trigger: "manual" | "hourly" | "daily" | "weekly";
    stepCount: number;
  };
}

/**
 * Inline preview card when the agent emitted a `<<reflex:workflow-create>>`
 * marker. Mirrors the widget-preview-card pattern: violet-tinted frame,
 * link straight to the editor where the user can tweak/run.
 */
export function WorkflowPreviewCard({ rootId, workflow }: Props) {
  return (
    <div className="my-3 rounded-lg border border-violet-200 bg-violet-50/40 dark:border-violet-900/40 dark:bg-violet-950/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-violet-200 dark:border-violet-900/40 bg-violet-100/40 dark:bg-violet-900/20 text-xs">
        <Sparkles className="h-3 w-3 text-violet-600" />
        <span className="font-medium text-violet-900 dark:text-violet-200">
          Workflow создан
        </span>
        <Badge variant="outline" className="text-[10px] font-mono">
          {workflow.trigger}
        </Badge>
        <span className="text-[10px] text-muted-foreground font-mono ml-1">
          {workflow.workflowId}
        </span>
      </div>
      <div className="p-3 space-y-2 bg-card">
        <div className="flex items-start gap-2">
          <Workflow className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium">{workflow.label}</h4>
            {workflow.description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {workflow.description}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              {workflow.stepCount} шагов · триггер{" "}
              <code className="font-mono">{workflow.trigger}</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1 text-xs">
          <Link
            href={`/roots/${rootId}/workflows/${workflow.workflowId}`}
            className="inline-flex items-center gap-1 rounded px-2 py-1 bg-violet-600 text-white hover:bg-violet-700"
          >
            <ArrowRight className="h-3 w-3" />
            Открыть в редакторе
          </Link>
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Pencil className="h-2.5 w-2.5" />
            редактируй здесь же через чат
          </span>
        </div>
      </div>
    </div>
  );
}
