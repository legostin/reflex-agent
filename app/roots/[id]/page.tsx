import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderOpen, RefreshCw, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { kbStats } from "@/lib/server/kb";
import { loadDashboardSnapshotAction } from "@/lib/server/dashboard-actions";
import { listUtilities } from "@/lib/server/utilities/store";
import { Dashboard } from "./_components/dashboard";
import { RunInitButton } from "./_components/run-init-button";
import { CommandBar } from "./_components/command-bar";
import { ShareButton } from "@/app/_components/share-button";
import { InsertImageButton } from "@/app/_components/kb/insert-image-button";
import { AddUtilityButton } from "./_components/add-utility-button";

export default async function RootDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();
  const [stats, snapshotResult, installedUtilities] = await Promise.all([
    kbStats(entry.path),
    loadDashboardSnapshotAction(id),
    listUtilities({ rootId: id }),
  ]);
  const snapshot = snapshotResult.ok ? snapshotResult.snapshot : undefined;
  const installedUtilityRefs = installedUtilities.map((u) => ({
    id: u.manifest.id,
    name: u.manifest.name,
    scope: u.scope,
  }));

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-4 flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Roots
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <h1 className="text-base font-medium truncate">{entry.path}</h1>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {stats.exists ? (
              <>
                <Badge variant="secondary">{stats.fileCount} MD files</Badge>
                {entry.lastInitAt ? (
                  <span>
                    Last init {new Date(entry.lastInitAt).toLocaleString()}
                  </span>
                ) : (
                  <span>No init recorded</span>
                )}
              </>
            ) : (
              <Badge variant="outline">.reflex/ not yet created</Badge>
            )}
          </div>
        </div>
        <AddUtilityButton
          rootId={entry.id}
          installed={installedUtilityRefs}
        />
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link href={`/roots/${entry.id}/workflows`}>
            <Workflow className="h-4 w-4" />
            Workflows
          </Link>
        </Button>
        <InsertImageButton rootId={entry.id} />
        <ShareButton
          kind="project"
          rootId={entry.id}
          label={entry.path.split("/").pop() || "Проект"}
        />
        <RunInitButton rootPath={entry.path} rootId={entry.id} />
      </header>
      <Separator />
      {!snapshot ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-10 text-center">
            <RefreshCw className="h-6 w-6" />
            <p>
              Не удалось загрузить состояние проекта
              {snapshotResult.ok ? "" : `: ${snapshotResult.error ?? ""}`}.
            </p>
            <p className="text-xs">
              Попробуй <strong>Run init</strong> сверху, если это новый проект.
            </p>
          </div>
          <CommandBar rootId={entry.id} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <Dashboard rootId={entry.id} initialSnapshot={snapshot} />
          <CommandBar rootId={entry.id} />
        </div>
      )}
    </main>
  );
}
