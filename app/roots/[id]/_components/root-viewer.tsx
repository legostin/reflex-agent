"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { KbFileShallow, KbFileMeta } from "@/lib/server/kb";
import { MarkdownView } from "./markdown-view";
import { readKbFileAction } from "./actions";
import { CommandBar } from "./command-bar";
import { EntityBadges } from "./entity-badges";
import { startTopicAction } from "@/lib/server/topic-actions";

interface Props {
  files: KbFileShallow[];
  rootId: string;
  rootPath: string;
  initialFile?: string | null;
}

/**
 * Single-column content area for a project. The outer app sidebar provides KB
 * navigation; this component just renders the currently-selected MD file (via
 * `?file=` URL param) and pins the CommandBar to the bottom of the column.
 */
export function RootViewer({ files, rootId, rootPath, initialFile }: Props) {
  const t = useTranslations("roots");
  const filesByRel = (() => {
    const m = new Map<string, KbFileShallow>();
    for (const f of files) m.set(f.rel, f);
    return m;
  })();
  const defaultSelected =
    (initialFile && filesByRel.has(initialFile)
      ? initialFile
      : filesByRel.has("INDEX.md")
        ? "INDEX.md"
        : files[0]?.rel) ?? null;
  const [selected, setSelected] = useState<string | null>(defaultSelected);
  const [content, setContent] = useState<string>("");
  const [meta, setMeta] = useState<KbFileMeta | null>(null);
  const [loading, startLoading] = useTransition();
  const router = useRouter();

  // KB context: user already got a Gemini summary inline on the embed; if
  // they want to keep working with it, this opens a fresh topic seeded with
  // the summary as conversational context.
  const sendSummaryToChat = (text: string, url: string) => {
    void (async () => {
      const message = t("kb.summaryContext", { url, text });
      const res = await startTopicAction(rootId, message);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push(`/roots/${rootId}/chat/${res.topicId}`);
    })();
  };

  // Sync to ?file= changes from the outer sidebar without a full route reload.
  useEffect(() => {
    if (initialFile && filesByRel.has(initialFile)) {
      setSelected(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  useEffect(() => {
    if (!selected) return;
    startLoading(async () => {
      const res = await readKbFileAction(rootId, selected);
      if (res.ok) {
        setContent(res.content);
        setMeta(res.meta);
      } else {
        setContent(`# Error\n\n${res.error ?? ""}`);
        setMeta(null);
      }
    });
  }, [selected, rootId]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        <article className="mx-auto max-w-3xl px-8 py-10">
          {selected ? (
            loading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-3/5" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : (
              <>
                {meta && <MetaHeader meta={meta} filename={selected} />}
                <MarkdownView
                  source={stripFrontmatter(content)}
                  onSendToChat={sendSummaryToChat}
                />
              </>
            )
          ) : (
            <p className="text-muted-foreground">
              {t("kb.selectFileHint")}
            </p>
          )}
          <div className="mt-10 text-[11px] text-muted-foreground font-mono truncate">
            {rootPath}/.reflex/
          </div>
        </article>
      </ScrollArea>
      <CommandBar rootId={rootId} focusFile={selected ?? undefined} />
    </div>
  );
}

function MetaHeader({ meta, filename }: { meta: KbFileMeta; filename: string }) {
  const hasAny =
    meta.title || meta.version !== undefined || meta.date || meta.kind;
  if (!hasAny) return null;
  return (
    <header className="mb-6 pb-4 border-b space-y-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">
          {meta.title ?? filename}
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {meta.kind && (
            <Badge variant="default" className="capitalize">
              {meta.kind}
            </Badge>
          )}
          {meta.version !== undefined && (
            <Badge variant="outline">v{meta.version}</Badge>
          )}
          {meta.date && <span className="font-mono">{meta.date}</span>}
        </div>
      </div>
      <ProvenanceBadge createdBy={(meta.data as { createdBy?: unknown }).createdBy} />
      <EntityBadges kind={meta.kind} data={meta.data} />
      <div className="text-[11px] text-muted-foreground font-mono">
        {filename}
      </div>
    </header>
  );
}

/**
 * Renders a "created by X" pill when the KB file's frontmatter carries a
 * `createdBy` tag in the form `<kind>:<id>[@<version>]`. Utilities get a
 * clickable deep-link to their detail page; other origins (workflow,
 * agent, ...) get a passive label.
 */
function ProvenanceBadge({ createdBy }: { createdBy?: unknown }) {
  const t = useTranslations("roots");
  if (typeof createdBy !== "string" || !createdBy) return null;
  const [origin, rest] = createdBy.split(":", 2);
  if (!origin || !rest) return null;
  const [id, version] = rest.split("@", 2);
  const label =
    origin === "utility"
      ? t("kb.createdMiniApp")
      : origin === "workflow"
        ? t("kb.createdWorkflow")
        : origin === "agent"
          ? t("kb.createdAgent")
          : origin;
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-full border bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {t("kb.createdLabel")}
      </span>
      <span>{label}</span>
      <code className="font-mono">{id}</code>
      {version && (
        <span className="font-mono text-muted-foreground">v{version}</span>
      )}
    </span>
  );
  if (origin === "utility" && id) {
    return (
      <a
        href={`/utilities/project/${encodeURIComponent(id)}`}
        className="inline-block hover:opacity-80"
        title={t("kb.openMiniApp")}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

function stripFrontmatter(s: string): string {
  if (!s.startsWith("---")) return s;
  const end = s.indexOf("\n---", 3);
  if (end < 0) return s;
  const after = s.slice(end + 4);
  return after.replace(/^\r?\n/, "");
}
