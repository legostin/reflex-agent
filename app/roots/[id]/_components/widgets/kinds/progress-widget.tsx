"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import type { ProgressData } from "@/lib/server/widgets/types";

type Item = ProgressData["items"][number];

/**
 * Goal-tracking bars. Interactive: -/+ buttons next to each item bump
 * `current` ±1. Cap at [0, target] for the bar fill; the underlying
 * value is free-form so agents can over-shoot if they want.
 */
export function ProgressWidget({
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: ProgressData;
  readonly?: boolean;
  onPatch?: (next: ProgressData) => Promise<void> | void;
}) {
  const initial = data.items ?? [];
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, startSave] = useTransition();
  const prevPropsJson = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(initial);
    if (key !== prevPropsJson.current) {
      prevPropsJson.current = key;
      setItems(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const persist = (next: Item[]) => {
    setItems(next);
    if (!onPatch) return;
    startSave(async () => {
      try {
        await onPatch({ items: next });
      } catch {
        /* wrapper toasted */
      }
    });
  };

  const bump = (i: number, delta: number) => {
    if (readonly) return;
    persist(
      items.map((it, idx) =>
        idx === i ? { ...it, current: Math.max(0, it.current + delta) } : it,
      ),
    );
  };

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Нет целей.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const pct =
          it.target > 0
            ? Math.max(0, Math.min(100, (it.current / it.target) * 100))
            : 0;
        return (
          <li key={i} className="space-y-1 group/row">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate flex-1 min-w-0">{it.label}</span>
              {!readonly && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={() => bump(i, -1)}
                    disabled={pending || it.current <= 0}
                    aria-label="−1"
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => bump(i, 1)}
                    disabled={pending}
                    aria-label="+1"
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              )}
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {it.current} / {it.target}
                {it.unit ? ` ${it.unit}` : ""}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-violet-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
