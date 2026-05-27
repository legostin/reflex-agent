import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderPlus,
  Loader2,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { loadSettings } from "@/lib/settings/store";
import { loadGlobalSnapshotAction } from "@/lib/server/global-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UniversalChatBar } from "./_components/universal-chat-bar";

/**
 * Daily Home — the unified entry point of Reflex. Replaces the old
 * project-list with a proactive snapshot that aggregates every signal
 * across Spaces, so the user opens Reflex in the morning and sees what
 * matters today without picking a Space first.
 *
 * Server-rendered for first paint, hydrated by `UniversalChatBar` which
 * is sticky at the bottom of the viewport.
 */
export default async function HomePage() {
  const settings = await loadSettings();
  if (!settings.onboardedAt) {
    redirect("/onboarding");
  }
  const snapshot = await loadGlobalSnapshotAction();
  const greeting = greetingFor(settings.userName, settings.timezone);
  const totalPending = snapshot.pending.length;
  const totalGoals = snapshot.activeGoals.length;

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 pt-8 pb-32 space-y-6">
          {/* Morning card */}
          <Card className="border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-emerald-50 dark:from-violet-950/30 dark:to-emerald-950/30">
            <CardContent className="pt-6 pb-6 flex items-start gap-4">
              <div className="reflex-gradient h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-semibold">
                  {greeting}
                  {settings.userName ? `, ${settings.userName}` : ""}
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {summaryLine(snapshot.spaces.length, totalPending, totalGoals)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings">
                    <Settings className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button asChild variant="default" size="sm">
                  <Link href="/roots/new">
                    <FolderPlus className="mr-1 h-3.5 w-3.5" />
                    Пространство
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pending (always show even when empty so user knows it exists) */}
          <Section
            title="Ждут реакции"
            subtitle={
              totalPending === 0
                ? "Никаких висящих карточек — всё разобрано."
                : `${totalPending} карточек требуют ответа`
            }
          >
            {snapshot.pending.length === 0 ? (
              <EmptyHint icon={<CheckCircle2 className="h-4 w-4" />}>
                Всё чисто
              </EmptyHint>
            ) : (
              <ul className="space-y-1.5">
                {snapshot.pending.slice(0, 6).map((p) => (
                  <li key={`${p.rootId}-${p.requestId}`}>
                    <Link
                      href={`/roots/${p.rootId}/chat/${p.topicId}`}
                      className="flex items-start gap-2 rounded border bg-card px-3 py-2 hover:bg-accent"
                    >
                      <Badge variant="outline" className="font-mono text-[10px] mt-0.5">
                        {p.kind}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{p.summary}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.spaceLabel} · {relTime(p.ts)}
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground mt-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Active goals */}
          {snapshot.activeGoals.length > 0 && (
            <Section title="Активные цели" subtitle="Над чем сейчас идёт работа">
              <ul className="space-y-1.5">
                {snapshot.activeGoals.slice(0, 6).map((g) => (
                  <li key={`${g.rootId}-${g.topicId}`}>
                    <Link
                      href={`/roots/${g.rootId}/chat/${g.topicId}`}
                      className="flex items-start gap-2 rounded border bg-card px-3 py-2 hover:bg-accent"
                    >
                      <Target className="h-3.5 w-3.5 mt-0.5 text-violet-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{g.goal}</div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                          {g.spaceLabel} · {g.goalIterations} итераций ·{" "}
                          {relTime(g.updatedAt)}
                          {g.running && (
                            <Loader2 className="h-3 w-3 animate-spin text-violet-600 ml-1" />
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Recent KB across all Spaces */}
          {snapshot.recentKb.length > 0 && (
            <Section title="Свежее в памяти" subtitle="Что недавно записалось">
              <ul className="space-y-1">
                {snapshot.recentKb.slice(0, 6).map((kb) => (
                  <li key={`${kb.rootId}-${kb.rel}`}>
                    <Link
                      href={`/roots/${kb.rootId}/kb/${kb.rel
                        .split("/")
                        .map(encodeURIComponent)
                        .join("/")}`}
                      className="flex items-start gap-2 rounded border bg-card px-3 py-1.5 hover:bg-accent"
                    >
                      <FileText className="h-3 w-3 mt-1 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{kb.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {kb.spaceLabel} · {relTime(kb.modifiedAt)}
                          {kb.kind ? ` · ${kb.kind}` : ""}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Spaces grid */}
          <Section
            title="Твои пространства"
            subtitle={`${snapshot.spaces.length} · добавь ещё /onboarding`}
          >
            {snapshot.spaces.length === 0 ? (
              <EmptyHint icon={<FolderPlus className="h-4 w-4" />}>
                Пока ни одного.{" "}
                <Link href="/onboarding?force=1" className="underline">
                  Запустить мастер
                </Link>{" "}
                или{" "}
                <Link href="/roots/new" className="underline">
                  добавить вручную
                </Link>
                .
              </EmptyHint>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {snapshot.spaces.map((s) => (
                  <Link
                    key={s.rootId}
                    href={`/roots/${s.rootId}`}
                    className="rounded-lg border bg-card p-3 hover:bg-accent transition"
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate flex-1">
                        {s.label}
                      </div>
                      {(s.pendingCount > 0 || s.runningAgentsCount > 0) && (
                        <Badge variant="default" className="text-[10px]">
                          {s.pendingCount + s.runningAgentsCount}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span>{s.kbFileCount} заметок</span>
                      {s.activeGoalsCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{s.activeGoalsCount} целей</span>
                        </>
                      )}
                      {s.lastKbActivityAt && (
                        <>
                          <span>·</span>
                          <span>{relTime(s.lastKbActivityAt)}</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-muted-foreground/70 truncate">
                      {s.path}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      <UniversalChatBar spaces={snapshot.spaces.map((s) => ({ id: s.rootId, label: s.label }))} />
    </main>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function EmptyHint({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-dashed bg-card/40 px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-1.5">
      {icon}
      {children}
    </div>
  );
}

function greetingFor(name: string, timezone: string): string {
  let hour = new Date().getHours();
  if (timezone) {
    try {
      hour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "numeric",
          hour12: false,
        }).format(new Date()),
      );
    } catch {
      /* fall back to server-local */
    }
  }
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function summaryLine(
  spaces: number,
  pending: number,
  goals: number,
): string {
  const bits: string[] = [];
  bits.push(spaces === 0 ? "Пока ни одного пространства" : `${spaces} пространств${spaces === 1 ? "о" : ""}`);
  if (pending > 0) bits.push(`${pending} ждёт реакции`);
  if (goals > 0) bits.push(`${goals} целей в работе`);
  if (pending === 0 && goals === 0 && spaces > 0) {
    bits.push("ничего срочного");
  }
  return bits.join(" · ");
}

function relTime(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  return `${d}d`;
}
