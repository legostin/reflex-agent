import Link from "next/link";
import { ArrowLeft, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { readAudit } from "@/lib/server/utilities/audit";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; utility?: string }>;
}) {
  const { date, utility } = await searchParams;
  const { date: activeDate, entries, availableDates } = await readAudit({
    ...(date ? { date } : {}),
    filter: utility ? { utilityId: utility } : undefined,
    limit: 500,
  });

  // Pair start/end by correlationId to render unified rows.
  type Row = {
    correlationId: string;
    method: string;
    utilityId: string;
    scope: string;
    channel: string;
    startTs: string;
    endTs?: string;
    durationMs?: number;
    error?: string;
    args?: unknown;
    result?: unknown;
  };
  const byId = new Map<string, Row>();
  for (const e of entries) {
    let row = byId.get(e.correlationId);
    if (!row) {
      row = {
        correlationId: e.correlationId,
        method: e.method,
        utilityId: e.utilityId,
        scope: e.scope,
        channel: e.channel,
        startTs: e.ts,
      };
      byId.set(e.correlationId, row);
    }
    if (e.phase === "start") {
      row.startTs = e.ts;
      row.args = e.args;
    } else {
      row.endTs = e.ts;
      row.durationMs = e.durationMs;
      row.error = e.error;
      row.result = e.result;
    }
  }
  const rows = Array.from(byId.values()).sort((a, b) =>
    (b.endTs ?? b.startTs).localeCompare(a.endTs ?? a.startTs),
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Home
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-muted-foreground" /> Аудит
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Все вызовы Host API от утилит. Лог в{" "}
            <code className="font-mono">~/.reflex/audit/&lt;date&gt;.jsonl</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {availableDates.slice(0, 7).map((d) => (
            <Button
              key={d}
              asChild
              size="sm"
              variant={d === activeDate ? "default" : "outline"}
            >
              <Link href={`/audit?date=${d}${utility ? `&utility=${utility}` : ""}`}>{d}</Link>
            </Button>
          ))}
        </div>
      </header>
      <Separator className="mb-6" />

      {utility && (
        <div className="mb-4 text-xs">
          Фильтр: utility = <span className="font-mono">{utility}</span> ·{" "}
          <Link
            href={`/audit?date=${activeDate}`}
            className="underline-offset-2 hover:underline"
          >
            снять
          </Link>
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            В этот день не было вызовов утилит.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.correlationId}>
              <Card className={r.error ? "border-destructive/50" : ""}>
                <CardContent className="px-4 py-3 text-xs">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {r.error ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    <Badge variant="outline" className="font-mono">
                      {r.method}
                    </Badge>
                    <Link
                      href={`/audit?date=${activeDate}&utility=${encodeURIComponent(r.utilityId)}`}
                      className="font-mono text-muted-foreground hover:underline"
                    >
                      {r.utilityId}
                    </Link>
                    <Badge variant="secondary" className="text-[10px]">
                      {r.scope}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {r.channel}
                    </Badge>
                    {typeof r.durationMs === "number" && (
                      <span className="text-muted-foreground">
                        {r.durationMs}ms
                      </span>
                    )}
                    <span className="ml-auto font-mono text-muted-foreground">
                      {new Date(r.endTs ?? r.startTs).toLocaleTimeString()}
                    </span>
                  </div>
                  {r.error ? (
                    <div className="text-destructive">{r.error}</div>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">
                        args / result
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] bg-muted/30 rounded p-2">
                        {JSON.stringify(
                          { args: r.args, result: r.result },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
