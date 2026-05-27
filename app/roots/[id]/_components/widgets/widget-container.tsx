"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Clock,
  GripVertical,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { renderWidget } from "./registry";
import type {
  WidgetRecord,
  WidgetRefresh,
} from "@/lib/server/widgets/types";
import {
  patchWidgetDataAction,
  refreshWidgetNowAction,
  setWidgetRefreshAction,
} from "@/lib/server/widgets/actions";
import type { WidgetSizeMode } from "@/lib/server/widgets/types";
import { WidgetSizePicker, colSpanClassFor } from "./widget-size-picker";

interface Props {
  rootId: string;
  widget: WidgetRecord;
  mode: WidgetSizeMode;
  onHide: (id: string) => void;
  hiding: boolean;
  onLayoutChanged: () => void;
  /** Wire drag/drop affordances; container surfaces handle + drop target. */
  dnd: {
    onDragStart: (id: string) => void;
    onDragOver: (id: string) => void;
    onDrop: (id: string) => void;
    onDragEnd: () => void;
    dragging: string | null;
    dropTarget: string | null;
  };
}

/**
 * Frame for one user-created widget. Header has:
 *   - drag handle (left)
 *   - title + kind badge
 *   - pencil → opens the source topic so the user can ask the agent to
 *     refresh the widget
 *   - X → hide (moves to layout.hidden; still restorable from library)
 *
 * Body delegates to the per-kind renderer in `registry.tsx`.
 */
export function WidgetContainer({
  rootId,
  widget,
  mode,
  onHide,
  hiding,
  onLayoutChanged,
  dnd,
}: Props) {
  const t = useTranslations("roots");
  const [pendingHide, startHide] = useTransition();
  const isDragging = dnd.dragging === widget.id;
  const isDropTarget = dnd.dropTarget === widget.id && !isDragging;
  const colSpan = colSpanClassFor(mode);

  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", widget.id);
        dnd.onDragStart(widget.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dnd.dropTarget !== widget.id) dnd.onDragOver(widget.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dnd.onDrop(widget.id);
      }}
      onDragEnd={() => dnd.onDragEnd()}
      className={[
        colSpan,
        "transition-all",
        isDragging ? "opacity-50" : "",
        isDropTarget
          ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-background"
          : "",
      ].join(" ")}
    >
      <CardHeader className="pb-2 flex flex-row items-start gap-2 space-y-0">
        <GripVertical
          className="h-3.5 w-3.5 text-muted-foreground/60 cursor-grab active:cursor-grabbing mt-1 shrink-0"
          aria-label={t("widgetsCommon.dragHandle")}
        />
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <span className="truncate">{widget.title}</span>
            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
              {widget.kind}
            </Badge>
          </CardTitle>
          {widget.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              {widget.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 -mt-0.5 shrink-0">
          <WidgetSizePicker
            rootId={rootId}
            widgetId={widget.id}
            mode={mode}
            onChanged={onLayoutChanged}
          />
          {widget.sourceTopicId && (
            <Link
              href={`/roots/${rootId}/chat/${widget.sourceTopicId}`}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              aria-label={t("widgetsCommon.editViaTopicAria")}
              title={t("widgetsCommon.editViaTopicTitle")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={() =>
              startHide(async () => {
                await Promise.resolve();
                onHide(widget.id);
              })
            }
            disabled={pendingHide || hiding}
            aria-label={t("widgetsCommon.hideAria")}
            title={t("widgetsCommon.hideTitle")}
            className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {renderWidget(rootId, widget.kind, widget.data, {
          onPatch: async (newData) => {
            const r = await patchWidgetDataAction(
              rootId,
              widget.id,
              newData,
            );
            if (!r.ok) {
              toast.error(r.error ?? t("widgetsCommon.savePatchFailed"));
              throw new Error(r.error ?? t("widgetsCommon.patchFailed"));
            }
          },
        })}
        <RefreshControls rootId={rootId} widget={widget} />
      </CardContent>
    </Card>
  );
}

function RefreshControls({
  rootId,
  widget,
}: {
  rootId: string;
  widget: WidgetRecord;
}) {
  const t = useTranslations("roots");
  const [pendingRefresh, startRefresh] = useTransition();
  const [pendingCadence, startCadence] = useTransition();
  const refresh = widget.refresh ?? "manual";
  const last = widget.lastRefreshAt ?? widget.updatedAt;

  const onChangeCadence = (next: string) => {
    startCadence(async () => {
      const r = await setWidgetRefreshAction(
        rootId,
        widget.id,
        next as WidgetRefresh,
      );
      if (!r.ok) toast.error(r.error ?? t("widgetsCommon.cadenceFailed"));
      else
        toast.success(
          next === "manual"
            ? t("widgetsCommon.autoRefreshOff")
            : t("widgetsCommon.cadenceSet", {
                cadence: cadenceLabel(next as WidgetRefresh, t),
              }),
        );
    });
  };

  const onRefreshNow = () => {
    startRefresh(async () => {
      const r = await refreshWidgetNowAction(rootId, widget.id);
      if (!r.ok) toast.error(r.error ?? t("widgetsCommon.refreshFailed"));
      else toast.success(t("widgetsCommon.refreshStarted"));
    });
  };

  if (!widget.sourceTopicId) {
    // Without a source topic the agent has no place to be re-invoked from.
    // Manual button stays disabled; the cadence selector is hidden because
    // it would silently never fire.
    return null;
  }

  return (
    <div className="flex items-center gap-2 pt-2 border-t text-[11px] text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0" />
      <span className="shrink-0">
        {t("widgetsCommon.updatedAt", { time: formatRel(last, t) })}
      </span>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <Select
          value={refresh}
          onValueChange={onChangeCadence}
          disabled={pendingCadence}
        >
          <SelectTrigger className="h-6 text-[10px] gap-1 px-1.5 w-auto min-w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t("widgetsCommon.manual")}</SelectItem>
            <SelectItem value="hourly">{t("widgetsCommon.hourly")}</SelectItem>
            <SelectItem value="daily">{t("widgetsCommon.daily")}</SelectItem>
            <SelectItem value="weekly">{t("widgetsCommon.weekly")}</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRefreshNow}
          disabled={pendingRefresh}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent text-foreground/80 hover:text-foreground"
          title={t("widgetsCommon.refreshNowTitle")}
        >
          <RefreshCw
            className={`h-3 w-3 ${pendingRefresh ? "animate-spin" : ""}`}
          />
          {t("widgetsCommon.refreshLabel")}
        </button>
      </div>
    </div>
  );
}

function cadenceLabel(
  r: WidgetRefresh,
  t: ReturnType<typeof useTranslations>,
): string {
  if (r === "hourly") return t("widgetsCommon.cadenceHourly");
  if (r === "daily") return t("widgetsCommon.cadenceDaily");
  if (r === "weekly") return t("widgetsCommon.cadenceWeekly");
  return t("widgetsCommon.cadenceManual");
}

function formatRel(
  iso: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return t("widgetsCommon.justNow");
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("widgetsCommon.justNow");
  if (min < 60) return t("widgetsCommon.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("widgetsCommon.hoursAgo", { count: hr });
  const d = Math.floor(hr / 24);
  return t("widgetsCommon.daysAgo", { count: d });
}
