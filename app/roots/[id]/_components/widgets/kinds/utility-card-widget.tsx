"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import type { UtilityCardData } from "@/lib/server/widgets/types";
import { refreshUtilityCardAction } from "@/lib/server/widgets/actions";
import { renderWidget } from "../registry";

/**
 * Dashboard preview for an installed utility. Wraps a child widget kind
 * (KPI / markdown / progress / etc.) declared in the utility's
 * `manifest.card`, framing it with the utility name + a deep-link to the
 * full utility page.
 *
 * Live refresh: if the utility's card declares an `action`, we pull fresh
 * data on mount (so the card reflects reality without opening the
 * mini-app) and swap the inner snapshot in place. Without an action the
 * card is push-only — it shows whatever the utility last sent via
 * reflex.cards.update.
 */
export function UtilityCardWidget({
  rootId,
  data,
  widgetId,
  readonly,
}: {
  rootId: string;
  data: UtilityCardData;
  widgetId?: string;
  readonly?: boolean;
  onPatch?: (next: UtilityCardData) => void | Promise<void>;
}) {
  const t = useTranslations("roots");
  const [inner, setInner] = useState<UtilityCardData["inner"]>(data.inner);
  const [refreshing, setRefreshing] = useState(false);
  const didRefresh = useRef(false);

  // Pull live data once on mount. `readonly` covers the share/public
  // render path, where running a worker action would be wrong.
  useEffect(() => {
    if (readonly || !widgetId || didRefresh.current) return;
    didRefresh.current = true;
    let alive = true;
    setRefreshing(true);
    void (async () => {
      try {
        const res = await refreshUtilityCardAction(rootId, widgetId);
        if (alive && res.ok && res.inner) {
          setInner(res.inner as UtilityCardData["inner"]);
        }
      } finally {
        if (alive) setRefreshing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rootId, widgetId, readonly]);

  // Server may re-render with a newer snapshot (e.g. after a scheduler
  // refresh) — keep local state in sync when the prop changes.
  useEffect(() => {
    setInner(data.inner);
  }, [data.inner]);

  const utilityUrl =
    data.utilityScope === "project"
      ? `/utilities/project/${data.utilityId}?rootId=${encodeURIComponent(rootId)}`
      : `/utilities/global/${data.utilityId}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3 text-violet-600" />
        <span>{t("utilityCardWidget.miniAppLabel")}</span>
        <span className="font-mono normal-case tracking-normal text-muted-foreground/80">
          {data.utilityId}
        </span>
        {refreshing && (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
        )}
        <Link
          href={utilityUrl}
          className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-violet-700 hover:underline normal-case tracking-normal"
          title={t("utilityCardWidget.openFullTitle")}
        >
          {t("utilityCardWidget.openLabel")}
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
      {inner.title && <h4 className="text-sm font-medium">{inner.title}</h4>}
      {inner.description && (
        <p className="text-xs text-muted-foreground -mt-1">
          {inner.description}
        </p>
      )}
      <div>
        {renderWidget(rootId, inner.kind, inner.data, {
          // Inner display kinds stay read-only, but action-list needs to
          // be live so its buttons can invoke the utility's actions.
          readonly: inner.kind === "action-list" ? !!readonly : true,
          ...(widgetId ? { widgetId } : {}),
          utility: { id: data.utilityId, scope: data.utilityScope },
        })}
      </div>
    </div>
  );
}
