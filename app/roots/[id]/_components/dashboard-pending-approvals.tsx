"use client";

import Link from "next/link";
import {
  AlertTriangle,
  HelpCircle,
  Lock,
  PackagePlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PendingInteraction } from "@/lib/server/agents/pending-interactions";

interface Props {
  rootId: string;
  items: PendingInteraction[];
}

/**
 * "Reflex is waiting on you to approve / answer something." Aggregates
 * permission-request, question, and mcp-add-request cards across every
 * topic of the project. Clicking jumps to the originating chat where the
 * full approval UI lives.
 */
export function DashboardPendingApprovals({ rootId, items }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Ждут реакции
        </CardTitle>
        {items.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {items.length}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ничего не висит — все вопросы и одобрения отвечены.
          </p>
        )}
        {items.map((it) => (
          <Link
            key={`${it.kind}:${it.requestId}`}
            href={`/roots/${rootId}/chat/${it.topicId}`}
            className="block rounded-md border bg-card hover:bg-accent/40 transition px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <Icon kind={it.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {it.summary}
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {labelKind(it.kind)}
                  </Badge>
                </div>
                {it.details && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {it.details}
                  </p>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  topic {it.topicId.slice(0, 12)} · {formatRel(it.ts)}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function Icon({ kind }: { kind: PendingInteraction["kind"] }) {
  const cls = "h-3.5 w-3.5 mt-0.5 shrink-0";
  if (kind === "permission") return <Lock className={`${cls} text-rose-600`} />;
  if (kind === "question")
    return <HelpCircle className={`${cls} text-sky-600`} />;
  return <PackagePlus className={`${cls} text-emerald-600`} />;
}

function labelKind(k: PendingInteraction["kind"]): string {
  if (k === "permission") return "permission";
  if (k === "question") return "question";
  return "mcp-add";
}

function formatRel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "только что";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const d = Math.floor(hr / 24);
  return `${d} дн назад`;
}
