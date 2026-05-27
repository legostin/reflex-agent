"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readKbPreviewAction, type DashboardRecentKb } from "@/lib/server/dashboard-actions";

interface Props {
  rootId: string;
  items: DashboardRecentKb[];
}

/**
 * Recently modified KB files (≤6 within 72h). Previews load lazily after
 * mount so the initial snapshot stays small.
 */
export function DashboardRecentKb({ rootId, items }: Props) {
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const it of items) {
        if (previews[it.rel]) continue;
        const r = await readKbPreviewAction(rootId, it.rel);
        if (cancelled) return;
        if (r.ok) {
          setPreviews((cur) => ({ ...cur, [it.rel]: r.preview }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, items]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-700" />
          Свежее в KB
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
            За последние 72 часа никто не писал в KB.
          </p>
        )}
        {items.map((it) => (
          <Link
            key={it.rel}
            href={`/roots/${rootId}/kb/${encodePath(it.rel)}`}
            className="block rounded-md border bg-card hover:bg-accent/40 transition px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-700" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {it.title}
                  </span>
                  {it.kind && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {it.kind}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {previews[it.rel] ?? it.rel}
                </p>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {formatRel(it.modifiedAt)} · <span className="font-mono">{it.rel}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function encodePath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
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
