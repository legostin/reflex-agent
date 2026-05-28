"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionListData } from "@/lib/server/widgets/types";
import { invokeCardActionAction } from "@/lib/server/widgets/actions";

/**
 * Grouped list with optional per-item action buttons. When the widget
 * carries a utility context (it's the inner of a utility-card) each
 * item's `action` becomes a live button that invokes a server action of
 * that utility — e.g. a backlog task's "Send to agent". The result's
 * fresh snapshot is swapped in place so the list reflects the change
 * (the task leaves backlog) without a manual refresh.
 */
export function ActionListWidget({
  rootId,
  data,
  readonly,
  widgetId,
  utility,
}: {
  rootId: string;
  data: ActionListData;
  readonly?: boolean;
  widgetId?: string;
  utility?: { id: string; scope: "global" | "project" };
}) {
  const [groups, setGroups] = useState(data.groups ?? []);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setGroups(data.groups ?? []);
  }, [data.groups]);

  const canAct = !readonly && !!utility && !!widgetId;

  const runAction = async (
    itemId: string,
    action: NonNullable<ActionListData["groups"][number]["items"][number]["action"]>,
  ) => {
    if (!utility || !widgetId) return;
    if (action.confirm && !confirm(action.confirm)) return;
    setBusyId(itemId);
    try {
      const res = await invokeCardActionAction(rootId, {
        utilityId: utility.id,
        utilityScope: utility.scope,
        widgetId,
        actionName: action.actionName,
        args: { id: itemId, ...(action.args ?? {}) },
      });
      if (!res.ok) {
        toast.error(res.error ?? "Action failed");
        return;
      }
      if (
        res.inner &&
        (res.inner as { kind?: string }).kind === "action-list"
      ) {
        const fresh = (res.inner as { data?: ActionListData }).data;
        if (fresh?.groups) setGroups(fresh.groups);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing here yet.</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group, gi) => (
        <div key={gi} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {group.label}
            {group.items.length > 0 && (
              <span className="ml-1 text-muted-foreground/70">
                {group.items.length}
              </span>
            )}
          </div>
          {group.items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/80 italic">
              {group.emptyText ?? "empty"}
            </p>
          ) : (
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                >
                  {item.badge && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      {item.badge}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                  {item.action && canAct && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 shrink-0 text-[11px]"
                      disabled={busyId !== null}
                      onClick={() => void runAction(item.id, item.action!)}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        item.action.label
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
