"use client";

import { useTransition } from "react";
import { CheckCircle2, Target, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clearTopicGoalAction } from "@/lib/server/topic-actions";

interface Props {
  rootId: string;
  topicId: string;
  goal: string;
  status: "active" | "completed" | "abandoned";
  iterations: number;
}

export function GoalBadge({
  rootId,
  topicId,
  goal,
  status,
  iterations,
}: Props) {
  const [pending, start] = useTransition();
  const Icon = pickIcon(status);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
        status === "active" &&
          "reflex-gradient text-foreground border-transparent",
        status === "completed" && "border-emerald-500/40 bg-emerald-50",
        status === "abandoned" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider opacity-80">
          /goal · {status}{" "}
          {status === "active" && iterations > 0 && (
            <span className="font-mono">({iterations})</span>
          )}
        </div>
        <div className="truncate font-medium" title={goal}>
          {goal}
        </div>
      </div>
      {status === "active" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0"
          disabled={pending}
          onClick={() => {
            if (!confirm("Остановить выполнение цели?")) return;
            start(async () => {
              const res = await clearTopicGoalAction(rootId, topicId);
              if (!res.ok) toast.error(res.error ?? "Не удалось остановить");
              else toast.success("Цель снята с активного режима");
            });
          }}
        >
          <X className="mr-1 h-3 w-3" /> остановить
        </Button>
      )}
      {(status === "completed" || status === "abandoned") && (
        <Badge variant="outline" className="shrink-0 capitalize">
          {status}
        </Badge>
      )}
    </div>
  );
}

function pickIcon(status: string) {
  if (status === "completed") return CheckCircle2;
  if (status === "abandoned") return XCircle;
  return Target;
}
