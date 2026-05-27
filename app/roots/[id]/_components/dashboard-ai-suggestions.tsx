"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Lightbulb,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuggestionsCache } from "@/lib/server/ai-suggestions";
import { startTopicAction } from "@/lib/server/topic-actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

interface Props {
  rootId: string;
  cache: SuggestionsCache | null;
}

const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * AI-driven "what's next" card. On-demand refresh via the configured
 * `quick` assignment (Settings → Assignments). Cache lives at
 * `~/.reflex/roots/<id>/suggestions.json`, persists between visits.
 */
export function DashboardAiSuggestions({ rootId, cache }: Props) {
  const t = useTranslations("roots");
  const [current, setCurrent] = useState<SuggestionsCache | null>(cache);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();

  const refresh = () => {
    startRefresh(async () => {
      try {
        const res = await fetch(`/api/roots/${rootId}/suggestions`, {
          method: "POST",
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok: boolean;
          cache?: SuggestionsCache;
          error?: string;
        };
        if (!data.ok) {
          toast.error(data.error ?? t("aiSuggestions.regenerateFailed"));
          return;
        }
        if (data.cache) setCurrent(data.cache);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const stale =
    current &&
    Date.now() - Date.parse(current.generatedAt) > FRESH_TTL_MS;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t("aiSuggestions.title")}
          {stale && (
            <Badge variant="outline" className="text-[10px]">
              {t("aiSuggestions.stale")}
            </Badge>
          )}
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={refreshing}
          className="gap-1 h-7 text-xs"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t("aiSuggestions.recompute")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!current && !refreshing && (
          <p className="text-xs text-muted-foreground">
            {t("aiSuggestions.intro")}
          </p>
        )}

        {current && current.items.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("aiSuggestions.nothingUrgent")}
          </p>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          {current?.items.map((item, i) => (
            <div
              key={i}
              className="rounded-md border bg-card p-3 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm font-medium leading-snug flex-1">
                  {item.title}
                </p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.why}
              </p>
              <SuggestionActionButton
                rootId={rootId}
                item={item}
                router={router}
              />
            </div>
          ))}
        </div>

        {current && (
          <p className="text-[10px] text-muted-foreground pt-1">
            {t.rich("aiSuggestions.generatedAt", {
              time: formatRel(current.generatedAt, t),
              model: current.model,
              code: (chunks) => <code className="font-mono">{chunks}</code>,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionActionButton({
  rootId,
  item,
  router,
}: {
  rootId: string;
  item: SuggestionsCache["items"][number];
  router: ReturnType<typeof useRouter>;
}) {
  const [busy, startBusy] = useTransition();
  const t = useTranslations("roots");
  const { action } = item;
  if (action.kind === "none") return null;
  if (action.kind === "open-topic" && action.target) {
    return (
      <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
        <Link href={`/roots/${rootId}/chat/${action.target}`}>
          <ArrowRight className="h-3 w-3" />
          {action.label}
        </Link>
      </Button>
    );
  }
  if (action.kind === "open-kb" && action.target) {
    const encoded = action.target
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return (
      <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
        <Link href={`/roots/${rootId}/kb/${encoded}`}>
          <ArrowRight className="h-3 w-3" />
          {action.label}
        </Link>
      </Button>
    );
  }
  if (action.kind === "send-message" && action.target) {
    const send = () => {
      startBusy(async () => {
        try {
          const res = await startTopicAction(rootId, action.target!, [], undefined);
          if (!res.ok) {
            toast.error(res.error ?? t("aiSuggestions.sendFailed"));
            return;
          }
          dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
          router.push(`/roots/${rootId}/chat/${res.topicId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      });
    };
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1"
        onClick={send}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Send className="h-3 w-3" />
        )}
        {action.label}
      </Button>
    );
  }
  return null;
}

function formatRel(
  iso: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return t("aiSuggestions.justNow");
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("aiSuggestions.justNow");
  if (min < 60) return t("aiSuggestions.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("aiSuggestions.hoursAgo", { count: hr });
  const d = Math.floor(hr / 24);
  return t("aiSuggestions.daysAgo", { count: d });
}
