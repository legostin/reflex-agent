import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Brain, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { MemoryEditor } from "@/app/_components/memory/memory-editor";

export const dynamic = "force-dynamic";

export default async function ProjectMemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-4 flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/roots/${entry.id}`}>
            <LayoutDashboard className="mr-1 h-4 w-4" /> Dashboard
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Roots
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-600" /> Project memory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            What Reflex remembers about this Space specifically. Global
            memory (about you) lives in Settings.
          </p>
        </div>
      </header>
      <Separator />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-3xl mx-auto">
          <MemoryEditor
            scope="project"
            rootId={entry.id}
            title="Project memory"
            description="These files describe this Space and are loaded into every chat scoped to it. Edit any line directly, or let the agent maintain them as you talk."
          />
        </div>
      </div>
    </main>
  );
}
