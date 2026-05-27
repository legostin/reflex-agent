"use client";

import { useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, LibraryBig, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  deleteWidgetAction,
  hideWidgetAction,
  restoreWidgetAction,
} from "@/lib/server/widgets/actions";
import {
  SYSTEM_WIDGETS,
  type DashboardLayout,
  type WidgetRecord,
} from "@/lib/server/widgets/types";

interface Props {
  rootId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: WidgetRecord[];
  layout: DashboardLayout;
  onChanged: () => void;
}

/**
 * Widget library: every widget the project has ever produced (user-created
 * + 4 system slots), each with its current state (visible/hidden) and the
 * appropriate toggle button. User widgets also support permanent delete.
 *
 * Lightweight overlay (no Radix Dialog dep — we don't have one shipped in
 * this codebase yet). Escape closes; click-outside dismisses.
 */
export function WidgetsLibraryModal({
  rootId,
  open,
  onOpenChange,
  widgets,
  layout,
  onChanged,
}: Props) {
  const t = useTranslations("roots");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const hiddenSet = new Set(layout.hidden);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative bg-card border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <LibraryBig className="h-4 w-4 text-violet-600" />
          <h2 className="text-sm font-medium flex-1">{t("widgetsCommon.libraryTitle")}</h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            <section className="space-y-2">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("widgetsCommon.systemWidgetsHeading")}
              </h3>
              {SYSTEM_WIDGETS.map((sw) => (
                <LibraryRow
                  key={sw.id}
                  rootId={rootId}
                  id={sw.id}
                  title={sw.title}
                  description={sw.description}
                  badge="system"
                  badgeVariant="default"
                  hidden={hiddenSet.has(sw.id)}
                  canDelete={false}
                  onChanged={onChanged}
                />
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("widgetsCommon.userWidgetsHeading", { count: widgets.length })}
              </h3>
              {widgets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("widgetsCommon.noUserWidgets")}
                </p>
              )}
              {widgets.map((w) => (
                <LibraryRow
                  key={w.id}
                  rootId={rootId}
                  id={w.id}
                  title={w.title}
                  description={w.description ?? `kind: ${w.kind}`}
                  badge={w.kind}
                  badgeVariant="outline"
                  hidden={hiddenSet.has(w.id)}
                  canDelete
                  onChanged={onChanged}
                />
              ))}
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function LibraryRow({
  rootId,
  id,
  title,
  description,
  badge,
  badgeVariant,
  hidden,
  canDelete,
  onChanged,
}: {
  rootId: string;
  id: string;
  title: string;
  description: string;
  badge: string;
  badgeVariant: "default" | "outline" | "secondary";
  hidden: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("roots");
  const [pending, start] = useTransition();

  const toggle = () => {
    start(async () => {
      const r = hidden
        ? await restoreWidgetAction(rootId, id)
        : await hideWidgetAction(rootId, id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onChanged();
    });
  };

  const onDelete = () => {
    if (!confirm(t("widgetsCommon.deleteWidgetConfirm", { title }))) {
      return;
    }
    start(async () => {
      const r = await deleteWidgetAction(rootId, id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onChanged();
    });
  };

  return (
    <div className="flex items-start gap-3 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{title}</span>
          <Badge variant={badgeVariant} className="text-[10px] font-mono">
            {badge}
          </Badge>
          {hidden && (
            <Badge variant="secondary" className="text-[10px]">
              {t("widgetsCommon.hidden")}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {description}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={toggle}
          disabled={pending}
          className="gap-1 h-7 text-xs"
        >
          {hidden ? (
            <>
              <Eye className="h-3 w-3" />
              {t("widgetsCommon.show")}
            </>
          ) : (
            <>
              <EyeOff className="h-3 w-3" />
              {t("widgetsCommon.hide")}
            </>
          )}
        </Button>
        {canDelete && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={pending}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title={t("widgetsCommon.deleteForever")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
