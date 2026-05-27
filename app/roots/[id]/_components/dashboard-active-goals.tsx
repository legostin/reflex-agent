"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Target, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  DashboardActiveGoal,
  DashboardRunningAgent,
} from "@/lib/server/dashboard-actions";

interface Props {
  rootId: string;
  activeGoals: DashboardActiveGoal[];
  runningAgents: DashboardRunningAgent[];
}

/**
 * "What's the project actively working on right now." Two layers:
 *   1. Topics with a persistent /goal — long-running mode that auto-continues.
 *   2. Topics with a running agent but no /goal — short-lived current turn.
 * Both link straight into the chat for the topic.
 */
export function DashboardActiveGoals({ rootId, activeGoals, runningAgents }: Props) {
  const t = useTranslations("roots");
  const total = activeGoals.length + runningAgents.length;
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-violet-600" />
          {t("activeGoals.title")}
        </CardTitle>
        {total > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {total}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {total === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("activeGoals.empty")}
          </p>
        )}

        {activeGoals.map((g) => (
          <Link
            key={g.topicId}
            href={`/roots/${rootId}/chat/${g.topicId}`}
            className="block rounded-md border bg-card hover:bg-accent/40 transition px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <Target className="h-3.5 w-3.5 text-violet-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {g.topicTitle}
                  </span>
                  {g.running && (
                    <Loader2 className="h-3 w-3 animate-spin text-violet-600 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {g.goal}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <span>{t("activeGoals.iterationLabel", { count: g.goalIterations })}</span>
                  <span>·</span>
                  <span>{t("activeGoals.updatedLabel", { time: formatRel(g.updatedAt, t) })}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}

        {runningAgents.map((a) => (
          <Link
            key={a.topicId}
            href={`/roots/${rootId}/chat/${a.topicId}`}
            className="block rounded-md border bg-card hover:bg-accent/40 transition px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="text-sm font-medium truncate flex-1 min-w-0">
                  {a.topicTitle}
                </span>
                <Loader2 className="h-3 w-3 animate-spin text-amber-600 shrink-0" />
                <span className="text-[10px] text-muted-foreground">
                  {t("activeGoals.agentRunning")}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function formatRel(
  iso: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return t("activeGoals.justNow");
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("activeGoals.justNow");
  if (min < 60) return t("activeGoals.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("activeGoals.hoursAgo", { count: hr });
  const d = Math.floor(hr / 24);
  return t("activeGoals.daysAgo", { count: d });
}
