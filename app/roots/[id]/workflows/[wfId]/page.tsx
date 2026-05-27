import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { listRuns, readWorkflow } from "@/lib/server/workflows/store";
import { WorkflowEditor } from "./_components/workflow-editor";

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ id: string; wfId: string }>;
}) {
  const { id, wfId } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();
  const wf = await readWorkflow(entry.path, wfId);
  if (!wf) notFound();
  const runs = await listRuns(entry.path, wfId, 10);

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-4 flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/roots/${entry.id}/workflows`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Workflows
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium flex items-center gap-2 truncate">
            <Workflow className="h-4 w-4 text-violet-600 shrink-0" />
            <span className="truncate">{wf.label}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
            {wf.id}
          </p>
        </div>
      </header>
      <Separator />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-4xl mx-auto">
          <WorkflowEditor rootId={entry.id} initial={wf} initialRuns={runs} />
        </div>
      </div>
    </main>
  );
}
