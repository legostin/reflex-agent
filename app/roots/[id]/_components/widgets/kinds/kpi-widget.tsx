"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { KpiData } from "@/lib/server/widgets/types";

export function KpiWidget({
  data,
}: {
  rootId: string;
  data: KpiData;
  readonly?: boolean;
  onPatch?: (next: KpiData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  // KPI tiles are visual snapshots — refresh-driven, not click-driven.
  const items = data.items ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("kpiWidget.empty")}</p>;
  }
  const cols = Math.min(items.length, 3);
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-md border bg-card px-3 py-2 flex flex-col gap-0.5"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {it.label}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold tabular-nums">
              {it.value}
            </span>
            {it.delta === "up" && (
              <ArrowUp className="h-3.5 w-3.5 text-emerald-600" />
            )}
            {it.delta === "down" && (
              <ArrowDown className="h-3.5 w-3.5 text-rose-600" />
            )}
            {it.delta === "flat" && (
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
          {it.hint && (
            <div className="text-[10px] text-muted-foreground leading-snug">
              {it.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
