"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LibraryBig, Plus } from "lucide-react";
import {
  hideWidgetAction,
  saveWidgetOrderAction,
} from "@/lib/server/widgets/actions";
import type {
  DashboardLayout,
  WidgetRecord,
  WidgetSizeMode,
} from "@/lib/server/widgets/types";
import {
  SYSTEM_WIDGET_IDS,
  resolveSizeMode,
} from "@/lib/server/widgets/types";
import { WidgetSizePicker, colSpanClassFor } from "./widget-size-picker";
import { WidgetContainer } from "./widget-container";
import { WidgetsLibraryModal } from "./widgets-library-modal";
import type { DashboardSnapshot } from "@/lib/server/dashboard-actions";

type SystemRenderer = (id: string) => React.ReactNode;

interface Props {
  rootId: string;
  widgets: WidgetRecord[];
  layout: DashboardLayout;
  /** Map of `sys:<id>` → renderer node. Lets the dashboard inject the four
   *  built-in sections without making the grid know about their shape. */
  systemRenderers: Record<string, React.ReactNode>;
  snapshot: DashboardSnapshot;
  /** Called after a layout mutation so parent can refresh the snapshot. */
  onLayoutChanged: () => void;
}

/**
 * Unified widget grid: renders both system widgets (`sys:*` ids) and
 * user-created widgets, in the order saved in `layout.order`, skipping
 * anything in `layout.hidden`. HTML5 drag-and-drop reorder; per-widget
 * hide button; restore/delete via the library modal.
 */
export function WidgetsGrid({
  rootId,
  widgets,
  layout,
  systemRenderers,
  snapshot,
  onLayoutChanged,
}: Props) {
  const t = useTranslations("roots");
  const userById = useMemo(() => {
    const m = new Map<string, WidgetRecord>();
    for (const w of widgets) m.set(w.id, w);
    return m;
  }, [widgets]);
  const [order, setOrder] = useState<string[]>(layout.order);
  const [hidden, setHidden] = useState<string[]>(layout.hidden);
  const [, startMutate] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Sync from props when the parent refetches.
  useMemoSync(layout.order, setOrder);
  useMemoSync(layout.hidden, setHidden);

  const persistOrder = useCallback(
    (next: string[]) => {
      setOrder(next);
      startMutate(async () => {
        const r = await saveWidgetOrderAction(rootId, next);
        if (!r.ok) toast.error(r.error);
        else {
          setOrder(r.layout.order);
          setHidden(r.layout.hidden);
          onLayoutChanged();
        }
      });
    },
    [rootId, onLayoutChanged],
  );

  const onHide = useCallback(
    (id: string) => {
      const optimistic = order.filter((x) => x !== id);
      setOrder(optimistic);
      setHidden((h) => [...new Set([id, ...h])]);
      startMutate(async () => {
        const r = await hideWidgetAction(rootId, id);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setOrder(r.layout.order);
        setHidden(r.layout.hidden);
        onLayoutChanged();
      });
    },
    [rootId, order, onLayoutChanged],
  );

  const dnd = {
    onDragStart: (id: string) => setDragging(id),
    onDragOver: (id: string) => setDropTarget(id),
    onDrop: (targetId: string) => {
      const src = dragging;
      setDragging(null);
      setDropTarget(null);
      if (!src || src === targetId) return;
      const next = [...order];
      const fromIdx = next.indexOf(src);
      const toIdx = next.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, src);
      persistOrder(next);
    },
    onDragEnd: () => {
      setDragging(null);
      setDropTarget(null);
    },
    dragging,
    dropTarget,
  };

  const visibleIds = order;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {t("widgetsCommon.projectWidgetsTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("widgetsCommon.projectWidgetsHint")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLibraryOpen(true)}
          className="gap-1 h-8"
        >
          <LibraryBig className="h-3.5 w-3.5" />
          {t("widgetsCommon.library", { count: hidden.length })}
        </Button>
      </div>

      {visibleIds.length === 0 && (
        <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            {t.rich("widgetsCommon.emptyDashboard", {
              example: () => <em>{t("widgetsCommon.emptyDashboardExample")}</em>,
            })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLibraryOpen(true)}
            className="gap-1"
          >
            <Plus className="h-3 w-3" />
            {t("widgetsCommon.restoreSystem")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        {visibleIds.map((id) => {
          const w = userById.get(id);
          const sizeFromLayout = layout.sizes?.[id];
          const mode: WidgetSizeMode =
            sizeFromLayout ?? resolveSizeMode(w?.size);
          if ((SYSTEM_WIDGET_IDS as readonly string[]).includes(id)) {
            return (
              <SystemSlot
                key={id}
                rootId={rootId}
                id={id}
                node={systemRenderers[id]}
                onHide={onHide}
                dnd={dnd}
                mode={mode}
                onLayoutChanged={onLayoutChanged}
              />
            );
          }
          if (!w) return null;
          return (
            <WidgetContainer
              key={id}
              rootId={rootId}
              widget={w}
              mode={mode}
              onHide={onHide}
              hiding={false}
              dnd={dnd}
              onLayoutChanged={onLayoutChanged}
            />
          );
        })}
      </div>

      <WidgetsLibraryModal
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        rootId={rootId}
        widgets={widgets}
        layout={{ order, hidden }}
        onChanged={() => {
          onLayoutChanged();
        }}
      />
    </>
  );
}

/**
 * Wrap a system-block (the existing 4 dashboard sections) so it gets the
 * same drag-handle / hide-X affordances as user widgets, even though its
 * inner content is rendered by the parent and the body itself isn't a
 * Card. We mount the parent's rendered node inline — it already has its
 * own Card frame — and overlay the controls.
 */
function SystemSlot({
  rootId,
  id,
  node,
  onHide,
  dnd,
  mode,
  onLayoutChanged,
}: {
  rootId: string;
  id: string;
  node: React.ReactNode;
  onHide: (id: string) => void;
  dnd: {
    onDragStart: (id: string) => void;
    onDragOver: (id: string) => void;
    onDrop: (id: string) => void;
    onDragEnd: () => void;
    dragging: string | null;
    dropTarget: string | null;
  };
  mode: WidgetSizeMode;
  onLayoutChanged: () => void;
}) {
  const t = useTranslations("roots");
  const isDragging = dnd.dragging === id;
  const isDropTarget = dnd.dropTarget === id && !isDragging;
  const spanClass = colSpanClassFor(mode);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        dnd.onDragStart(id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dnd.dropTarget !== id) dnd.onDragOver(id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dnd.onDrop(id);
      }}
      onDragEnd={() => dnd.onDragEnd()}
      className={[
        spanClass,
        "relative group/sys transition-all",
        isDragging ? "opacity-50" : "",
        isDropTarget
          ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-background rounded-lg"
          : "",
      ].join(" ")}
    >
      {node}
      <div className="absolute top-2 right-2 opacity-0 group-hover/sys:opacity-100 transition-opacity flex items-center gap-1 bg-background/85 backdrop-blur rounded p-0.5">
        <WidgetSizePicker
          rootId={rootId}
          widgetId={id}
          mode={mode}
          onChanged={onLayoutChanged}
        />
        <button
          type="button"
          onClick={() => onHide(id)}
          aria-label={t("widgetsCommon.hideAria")}
          title={t("widgetsCommon.hideSystemTitle")}
          className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
        >
          ×
        </button>
      </div>
    </div>
  );
}


/**
 * Tiny utility: when `incoming` changes, push it into local state. Cheaper
 * than declaring two useEffects per array. Kept inline to avoid a separate
 * hook file for one usage.
 */
function useMemoSync<T>(incoming: T, setter: (next: T) => void): void {
  // Use useMemo for the comparison; React re-runs it on render anyway and
  // the cost is just a shallow string check.
  useMemo(() => {
    setter(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(incoming)]);
}
