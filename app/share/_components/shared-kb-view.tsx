import { FileText, Share2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import matter from "gray-matter";

/**
 * Read-only KB file viewer for public share links. We render the markdown
 * body straight through `react-markdown` with no syntax-highlighting
 * deps — keeps the share endpoint lean. Frontmatter is shown as a small
 * metadata block above the body so titled/dated notes feel less raw.
 */
export function SharedKbView({
  path,
  content,
  rootLabel,
}: {
  path: string;
  content: string;
  rootLabel: string;
}) {
  const parsed = matter(content);
  const meta = parsed.data as Record<string, unknown>;
  const title =
    (typeof meta.title === "string" && meta.title) || path.split("/").pop()!;
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-8">
      <article className="mx-auto max-w-3xl rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <header className="border-b pb-4 space-y-1">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
            <Share2 className="h-3 w-3" />
            Reflex Share · KB file
          </div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-violet-600 shrink-0" />
            {title}
          </h1>
          <p className="text-xs font-mono text-muted-foreground truncate">
            {rootLabel} · {path}
          </p>
          {Object.keys(meta).length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-2">
              {Object.entries(meta).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono">{k}</dt>
                  <dd className="truncate">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{parsed.content}</ReactMarkdown>
        </div>
      </article>
    </main>
  );
}
