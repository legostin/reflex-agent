"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setWidgetSizeAction } from "@/lib/server/widgets/actions";
import {
  SIZE_TO_COL_SPAN,
  type WidgetSizeMode,
} from "@/lib/server/widgets/types";

const OPTIONS: { mode: WidgetSizeMode; label: string; title: string }[] = [
  { mode: "sm", label: "S", title: "Маленький — 3 в ряд" },
  { mode: "md", label: "M", title: "Средний — 2 в ряд" },
  { mode: "wide", label: "W", title: "Широкий — на всю строку" },
];

/**
 * Inline S/M/W toggle for resizing a widget. Persists into the dashboard
 * layout file via `setWidgetSizeAction`. Optimistically the parent grid
 * doesn't have to re-render until the action returns — we wait for the
 * server confirmation and trigger `onChanged` to refresh the snapshot.
 *
 * Works for both user widgets and system slots; `widgetId` accepts the
 * full id (sys:* or kebab).
 */
export function WidgetSizePicker({
  rootId,
  widgetId,
  mode,
  onChanged,
}: {
  rootId: string;
  widgetId: string;
  mode: WidgetSizeMode;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const pick = (next: WidgetSizeMode) => {
    if (next === mode) return;
    start(async () => {
      const r = await setWidgetSizeAction(rootId, widgetId, next);
      if (!r.ok) {
        toast.error(r.error ?? "Не удалось");
        return;
      }
      onChanged();
    });
  };
  return (
    <div
      role="radiogroup"
      aria-label="Размер виджета"
      className="inline-flex items-center rounded border bg-background/80 backdrop-blur overflow-hidden text-[10px] leading-none"
    >
      {OPTIONS.map((opt) => {
        const active = opt.mode === mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.title}
            title={opt.title}
            onClick={() => pick(opt.mode)}
            disabled={pending}
            className={[
              "px-1.5 py-0.5 font-mono transition-colors disabled:opacity-50",
              active
                ? "bg-violet-600 text-white"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function colSpanClassFor(mode: WidgetSizeMode): string {
  const span = SIZE_TO_COL_SPAN[mode];
  // Pre-baked classes so Tailwind's JIT keeps them.
  if (span === 2) return "lg:col-span-2";
  if (span === 3) return "lg:col-span-3";
  return "lg:col-span-6";
}
