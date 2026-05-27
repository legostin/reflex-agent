"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, LayoutDashboard, Pencil, Pin, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { renderWidget } from "@/app/roots/[id]/_components/widgets/registry";
import { restoreWidgetAction } from "@/lib/server/widgets/actions";
import { toast } from "sonner";

interface Props {
  rootId: string;
  widget: {
    op: "create" | "update";
    widgetId: string;
    title: string;
    description?: string;
    widgetKind: string;
    data: unknown;
    sourceTopicId?: string;
  };
}

/**
 * Inline preview of a widget the agent just put on the dashboard. Same
 * renderer as the dashboard card itself; framed differently so the user
 * understands "this was created in this turn" vs "this is the dashboard".
 *
 * The agent emits this exactly once per `<<reflex:widget-create>>` or
 * `<<reflex:widget-update>>` marker; chat-view positions it at the spot
 * where the marker fell in the assistant's stream.
 */
export function WidgetPreviewCard({ rootId, widget }: Props) {
  const [pinned, setPinned] = useState(false);
  const [pinning, startPin] = useTransition();
  const handlePin = () => {
    startPin(async () => {
      const res = await restoreWidgetAction(rootId, widget.widgetId);
      if (res.ok) {
        setPinned(true);
        toast.success("Закреплено на дашборде");
      } else {
        toast.error(res.error);
      }
    });
  };
  return (
    <div className="my-3 rounded-lg border border-violet-200 bg-violet-50/40 dark:border-violet-900/40 dark:bg-violet-950/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-violet-200 dark:border-violet-900/40 bg-violet-100/40 dark:bg-violet-900/20 text-xs">
        <Sparkles className="h-3 w-3 text-violet-600" />
        <span className="font-medium text-violet-900 dark:text-violet-200">
          {widget.op === "create" ? "Виджет создан" : "Виджет обновлён"}
        </span>
        <Badge variant="outline" className="text-[10px] font-mono">
          {widget.widgetKind}
        </Badge>
        <span className="text-[10px] text-muted-foreground font-mono ml-1">
          {widget.widgetId}
        </span>
        {pinned ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-700">
            <Check className="h-3 w-3" />
            На дашборде
          </span>
        ) : (
          <button
            type="button"
            onClick={handlePin}
            disabled={pinning}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-violet-700 hover:underline disabled:opacity-50"
            title="Закрепить виджет на дашборде"
          >
            <Pin className="h-3 w-3" />
            {pinning ? "..." : "Закрепить на дашборде"}
          </button>
        )}
        <Link
          href={`/roots/${rootId}`}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-violet-700"
          title="Открыть дашборд"
        >
          <LayoutDashboard className="h-3 w-3" />
        </Link>
      </div>
      <div className="p-3 space-y-2 bg-card">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium">{widget.title}</h4>
            {widget.description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {widget.description}
              </p>
            )}
          </div>
          <span
            className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"
            title="Чтобы обновить — пиши тут же в чате"
          >
            <Pencil className="h-2.5 w-2.5" />
            редактируй через чат
          </span>
        </div>
        <div className="pt-1">
          {renderWidget(rootId, widget.widgetKind, widget.data, {
            readonly: true,
          })}
        </div>
      </div>
    </div>
  );
}
