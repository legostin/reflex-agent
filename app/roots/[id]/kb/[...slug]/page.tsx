import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderOpen, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { walkKbMarkdown } from "@/lib/server/kb";
import { RootViewer } from "../../_components/root-viewer";
import { ShareButton } from "@/app/_components/share-button";
import { InsertImageButton } from "@/app/_components/kb/insert-image-button";

/**
 * Dedicated KB-viewer route. The project main page is now a dashboard;
 * opening a specific file (from sidebar, recent-kb card, or anywhere else)
 * lands here so the URL is shareable and browser history works as expected.
 */
export default async function KbViewerPage({
  params,
}: {
  params: Promise<{ id: string; slug: string[] }>;
}) {
  const { id, slug } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();
  const files = await walkKbMarkdown(entry.path);
  const fileCount = files.length;
  const rel = slug.map(decodeURIComponent).join("/");
  const target = files.some((f) => f.rel === rel) ? rel : null;
  if (!target) notFound();
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
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <h1 className="text-base font-medium truncate">{entry.path}</h1>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{fileCount} MD files</Badge>
            <span className="font-mono truncate">{rel}</span>
          </div>
        </div>
        <InsertImageButton rootId={entry.id} />
        <ShareButton
          kind="kb-file"
          rootId={entry.id}
          kbRelPath={rel}
          label={rel}
        />
      </header>
      <Separator />
      <RootViewer
        files={files}
        rootId={entry.id}
        rootPath={entry.path}
        initialFile={target}
      />
    </main>
  );
}
