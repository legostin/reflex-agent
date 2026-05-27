import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LayoutDashboard, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { listWorkflows } from "@/lib/server/workflows/store";

export default async function WorkflowsListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();
  const workflows = await listWorkflows(entry.path);

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-4 flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/roots/${entry.id}`}>
            <LayoutDashboard className="mr-1 h-4 w-4" /> Дашборд
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Roots
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium flex items-center gap-2">
            <Workflow className="h-4 w-4 text-violet-600" /> Workflows
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Автоматизации для проекта. Создаются через чат («сделай workflow
            который…»), редактируются здесь, запускаются вручную или по
            расписанию.
          </p>
        </div>
      </header>
      <Separator />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-3">
          {workflows.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground space-y-2">
              <p>Здесь пока пусто.</p>
              <p className="text-xs">
                Пример запроса в чате:{" "}
                <em>
                  «сделай workflow: каждый день качай HN-rss, агентом собирай
                  дайджест и пиши в KB»
                </em>
              </p>
            </div>
          ) : (
            workflows.map((wf) => (
              <Link
                key={wf.id}
                href={`/roots/${entry.id}/workflows/${wf.id}`}
                className="block rounded-md border bg-card hover:bg-accent/40 transition px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <Workflow className="h-4 w-4 mt-0.5 shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {wf.label}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {wf.trigger}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {wf.steps.length}{" "}
                        {pluralRu(wf.steps.length, "шаг", "шага", "шагов")}
                      </Badge>
                    </div>
                    {wf.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {wf.description}
                      </p>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                      {wf.id} · обновлён {new Date(wf.updatedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
