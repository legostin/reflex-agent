"use client";

import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import type { UtilityCardData } from "@/lib/server/widgets/types";
import { renderWidget } from "../registry";

/**
 * Dashboard preview for an installed utility. Wraps a child widget kind
 * (KPI / markdown / progress / etc.) declared in the utility's
 * `manifest.card`, framing it with the utility name + a deep-link to the
 * full utility page. Read-only — the user clicks "Открыть" to interact.
 *
 * Refresh: utilities push fresh data via `reflex.cards.update({snapshot})`
 * from inside their own iframe / server-action. The wrapper just renders
 * the latest snapshot stored on the widget record.
 */
export function UtilityCardWidget({
  rootId,
  data,
  readonly,
}: {
  rootId: string;
  data: UtilityCardData;
  readonly?: boolean;
  onPatch?: (next: UtilityCardData) => void | Promise<void>;
}) {
  const utilityUrl =
    data.utilityScope === "project"
      ? `/utilities/project/${data.utilityId}?rootId=${encodeURIComponent(rootId)}`
      : `/utilities/global/${data.utilityId}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3 text-violet-600" />
        <span>Мини-приложение</span>
        <span className="font-mono normal-case tracking-normal text-muted-foreground/80">
          {data.utilityId}
        </span>
        <Link
          href={utilityUrl}
          className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-violet-700 hover:underline normal-case tracking-normal"
          title="Открыть полную версию"
        >
          Открыть
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
      {data.inner.title && (
        <h4 className="text-sm font-medium">{data.inner.title}</h4>
      )}
      {data.inner.description && (
        <p className="text-xs text-muted-foreground -mt-1">
          {data.inner.description}
        </p>
      )}
      <div>
        {renderWidget(rootId, data.inner.kind, data.inner.data, {
          readonly: true,
        })}
      </div>
    </div>
  );
}
