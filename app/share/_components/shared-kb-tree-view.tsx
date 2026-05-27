import Link from "next/link";
import { FileText, FolderTree, Share2 } from "lucide-react";

/**
 * Browseable index of every markdown file in the project's KB. Each row
 * links to `/share/<shareId>/file?rel=...` — there isn't actually a
 * separate dynamic route for that yet; we reuse the share-id and pass
 * the relative path as a query so a single share controls the auth
 * boundary for the entire tree.
 */
export function SharedKbTreeView({
  rootPath,
  files,
  shareId,
}: {
  rootPath: string;
  files: Array<{ rel: string; size: number; modifiedAt: string }>;
  shareId: string;
}) {
  const sorted = [...files].sort((a, b) =>
    a.rel.localeCompare(b.rel, "ru", { numeric: true }),
  );
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
            <Share2 className="h-3 w-3" />
            Reflex Share · KB tree
          </div>
          <h1 className="mt-1 text-lg font-semibold flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-violet-600 shrink-0" />
            База знаний ({sorted.length} файл.)
          </h1>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {rootPath}
          </p>
        </header>
        <ul className="rounded-lg border bg-card divide-y shadow-sm overflow-hidden">
          {sorted.map((f) => (
            <li key={f.rel}>
              <Link
                href={`/share/${shareId}/file?rel=${encodeURIComponent(f.rel)}`}
                className="flex items-start gap-2 px-3 py-2 hover:bg-accent text-sm"
              >
                <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono truncate">{f.rel}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {(f.size / 1024).toFixed(1)} KB ·{" "}
                    {new Date(f.modifiedAt).toLocaleString()}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
