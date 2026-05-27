"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { getRoot } from "@/lib/registry";
import {
  readKbMeta,
  walkKbMarkdown,
  type KbFileShallow,
} from "./kb";
import { listTopics, type TopicFrontmatter } from "./topics";
import { agentManager } from "./agents/manager";
import { listPendingForRoot, type PendingInteraction } from "./agents/pending-interactions";
import { listPendingMcpAdds } from "./agents/pending-mcp-adds";
import { readSuggestionsCache, type SuggestionsCache } from "./ai-suggestions";
import {
  listWidgets,
  readLayout,
  reconcileLayout,
  writeLayout,
} from "./widgets/store";
import {
  SYSTEM_WIDGET_IDS,
  type DashboardLayout,
  type WidgetRecord,
} from "./widgets/types";

/**
 * Server-side aggregator for the project main page. Pulls together every
 * "you should look at this" signal Reflex tracks across topics, KB, and
 * runtime state. Single round-trip on page mount; re-fetched on SSE ticks.
 */

export interface DashboardActiveGoal {
  topicId: string;
  topicTitle: string;
  goal: string;
  goalIterations: number;
  /** Topic's last update — proxy for "stuck since". */
  updatedAt: string;
  /** True if AgentManager currently has a running agent on this topic. */
  running: boolean;
}

export interface DashboardRunningAgent {
  topicId: string;
  topicTitle: string;
  updatedAt: string;
}

export interface DashboardRecentKb {
  rel: string;
  title: string;
  kind?: string;
  modifiedAt: string;
  /** First ~140 chars of the body (post-frontmatter). */
  preview: string;
}

export interface DashboardSnapshot {
  rootId: string;
  rootPath: string;
  activeGoals: DashboardActiveGoal[];
  /** Topics with a running agent but no /goal — separate signal. */
  runningAgents: DashboardRunningAgent[];
  pendingApprovals: PendingInteraction[];
  recentKb: DashboardRecentKb[];
  suggestions: SuggestionsCache | null;
  /** User-created widgets (agent-emitted via <<reflex:widget-create>>). */
  widgets: WidgetRecord[];
  /** Reconciled layout — includes both system and user widget ids. */
  layout: DashboardLayout;
}

export interface DashboardResult {
  ok: boolean;
  snapshot?: DashboardSnapshot;
  error?: string;
}

const RECENT_KB_LIMIT = 6;
const RECENT_KB_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

export async function loadDashboardSnapshotAction(
  rootId: string,
): Promise<DashboardResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const [topics, kbFiles, widgets, rawLayout] = await Promise.all([
      listTopics(entry.path),
      walkKbMarkdown(entry.path),
      listWidgets(entry.path),
      readLayout(entry.path),
    ]);
    const reconciled = reconcileLayout(
      rawLayout,
      widgets.map((w) => w.id),
      SYSTEM_WIDGET_IDS,
    );
    // Persist on every snapshot read — cheap, keeps the file in sync with
    // current widget set so dnd doesn't fight stale entries.
    if (
      reconciled.order.join("|") !== rawLayout.order.join("|") ||
      reconciled.hidden.join("|") !== rawLayout.hidden.join("|") ||
      JSON.stringify(reconciled.sizes ?? {}) !==
        JSON.stringify(rawLayout.sizes ?? {})
    ) {
      await writeLayout(entry.path, reconciled);
    }
    const topicIds = topics.map((t) => t.meta.id);
    // HMR-tolerant: the AgentManager singleton is cached on globalThis to
    // survive code reloads, but that means newly-added methods aren't
    // available on the cached instance until the dev server fully restarts.
    // Fall back to an empty set so the dashboard still renders.
    const runningTopicIds = new Set(
      typeof agentManager.listRunningTopicsForRoot === "function"
        ? agentManager.listRunningTopicsForRoot(rootId)
        : [],
    );
    const [pendingInteractions, pendingMcpAddsAll, suggestions] =
      await Promise.all([
        listPendingForRoot(entry.path, topicIds),
        listPendingMcpAdds(),
        readSuggestionsCache(rootId).catch(() => null),
      ]);
    // Pending MCP-add cards are also persisted on disk; merge them in (the
    // events-log scanner already catches anything that landed in the log,
    // but a fresh add may exist on disk before the topic's events.jsonl
    // even has the mcp-add-request line in some race-y cases).
    const seen = new Set(pendingInteractions.map((p) => p.requestId));
    for (const e of pendingMcpAddsAll) {
      if (seen.has(e.requestId)) continue;
      if (!topicIds.includes(e.topicId)) continue;
      pendingInteractions.push({
        kind: "mcp-add",
        topicId: e.topicId,
        requestId: e.requestId,
        ts: e.createdAt,
        summary: `MCP add: ${e.directive.label}`,
        ...(e.directive.description
          ? { details: e.directive.description }
          : {}),
      });
    }
    pendingInteractions.sort((a, b) => (a.ts < b.ts ? 1 : -1));

    const topicMetaById = new Map<string, TopicFrontmatter>();
    for (const t of topics) topicMetaById.set(t.meta.id, t.meta);
    const activeGoals: DashboardActiveGoal[] = [];
    const runningAgents: DashboardRunningAgent[] = [];
    for (const t of topics) {
      const m = t.meta;
      if (m.goal && m.goalStatus === "active") {
        activeGoals.push({
          topicId: m.id,
          topicTitle: m.title,
          goal: m.goal,
          goalIterations: m.goalIterations ?? 0,
          updatedAt: m.updatedAt,
          running: runningTopicIds.has(m.id),
        });
        continue;
      }
      if (runningTopicIds.has(m.id)) {
        runningAgents.push({
          topicId: m.id,
          topicTitle: m.title,
          updatedAt: m.updatedAt,
        });
      }
    }
    activeGoals.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    runningAgents.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    const recentKb = await pickRecentKb(kbFiles);
    return {
      ok: true,
      snapshot: {
        rootId,
        rootPath: entry.path,
        activeGoals,
        runningAgents,
        pendingApprovals: pendingInteractions,
        recentKb,
        suggestions,
        widgets,
        layout: reconciled,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Pick the top-N recently-modified KB files within the 72h window. Reads
 * frontmatter ONLY for the picked files (≤6) — saves N-6 disk reads on a
 * typical project. Falls back to basename when title is missing.
 */
async function pickRecentKb(
  files: KbFileShallow[],
): Promise<DashboardRecentKb[]> {
  const cutoff = Date.now() - RECENT_KB_WINDOW_MS;
  const recent = files
    .filter((f) => Date.parse(f.modifiedAt) >= cutoff)
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
    .slice(0, RECENT_KB_LIMIT);
  return Promise.all(
    recent.map(async (f) => {
      const meta = await readKbMeta(f.abs);
      return {
        rel: f.rel,
        title: meta.title ?? path.basename(f.rel),
        ...(meta.kind ? { kind: meta.kind } : {}),
        modifiedAt: f.modifiedAt,
        preview: "",
      };
    }),
  );
}

/**
 * Lazy preview reader. Called on demand for the recent-kb section so we
 * don't read every file's body upfront. Returns at most 200 chars of the
 * body (post-frontmatter).
 */
export async function readKbPreviewAction(
  rootId: string,
  rel: string,
): Promise<{ ok: true; preview: string } | { ok: false; error: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const abs = path.join(entry.path, ".reflex", rel);
    const check = path.relative(path.join(entry.path, ".reflex"), abs);
    if (check.startsWith("..") || path.isAbsolute(check)) {
      return { ok: false, error: "Refused (path traversal)" };
    }
    const raw = await fs.readFile(abs, "utf8");
    return { ok: true, preview: extractPreview(raw) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractPreview(raw: string): string {
  // Strip leading frontmatter block (--- … ---) if present.
  let body = raw;
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (fm) body = raw.slice(fm[0].length);
  // Strip markdown formatting that adds visual noise in a tight preview.
  body = body
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r?\n+/g, " ")
    .trim();
  if (body.length > 200) body = body.slice(0, 197).trimEnd() + "…";
  return body;
}
