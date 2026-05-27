"use server";

import path from "node:path";
import { listRoots, type RegistryEntry } from "@/lib/registry";
import { readKbMeta, walkKbMarkdown } from "./kb";
import { listTopics } from "./topics";
import { agentManager } from "./agents/manager";
import {
  listPendingForRoot,
  type PendingInteraction,
} from "./agents/pending-interactions";

/**
 * Cross-project home-page aggregator. Pulls the same "you should look
 * here" signals the per-root dashboard tracks, but rolled up across
 * every Space so the user's first screen is a single proactive view.
 *
 * Implementation is intentionally additive — reuses per-root primitives
 * via Promise.all so adding a Space doesn't slow the home page down
 * super-linearly. Each per-root probe is cheap (mtime-cached pending
 * scanner, stat-only KB walk).
 */

export interface GlobalSpaceSummary {
  rootId: string;
  path: string;
  /** Last segment of the path — e.g. "Finance", "Health". */
  label: string;
  kbFileCount: number;
  /** ISO timestamp of the most recently-modified KB file (or empty). */
  lastKbActivityAt: string;
  pendingCount: number;
  activeGoalsCount: number;
  runningAgentsCount: number;
}

export interface GlobalRecentKbItem {
  rootId: string;
  spaceLabel: string;
  rel: string;
  title: string;
  kind?: string;
  modifiedAt: string;
}

export interface GlobalActiveGoal {
  rootId: string;
  spaceLabel: string;
  topicId: string;
  topicTitle: string;
  goal: string;
  goalIterations: number;
  updatedAt: string;
  running: boolean;
}

export interface GlobalPending extends PendingInteraction {
  rootId: string;
  spaceLabel: string;
}

export interface GlobalSnapshot {
  spaces: GlobalSpaceSummary[];
  recentKb: GlobalRecentKbItem[];
  activeGoals: GlobalActiveGoal[];
  pending: GlobalPending[];
  /** ISO timestamp of when this snapshot was assembled. */
  generatedAt: string;
}

const RECENT_KB_LIMIT = 8;
const RECENT_KB_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Single round-trip: walks every registered root in parallel and folds
 * results. Returns at most ~few-KB JSON — the home page consumes it as
 * `initialData` and refreshes on SSE ticks.
 */
export async function loadGlobalSnapshotAction(): Promise<GlobalSnapshot> {
  const roots = await listRoots().catch(() => [] as RegistryEntry[]);
  const perRoot = await Promise.all(
    roots.map(async (root) => {
      try {
        const [topics, kbFiles] = await Promise.all([
          listTopics(root.path),
          walkKbMarkdown(root.path),
        ]);
        const topicIds = topics.map((t) => t.meta.id);
        const runningSet = new Set(
          typeof agentManager.listRunningTopicsForRoot === "function"
            ? agentManager.listRunningTopicsForRoot(root.id)
            : [],
        );
        const pending = await listPendingForRoot(root.path, topicIds);
        const activeGoals = topics
          .filter((t) => t.meta.goal && t.meta.goalStatus === "active")
          .map((t) => ({
            rootId: root.id,
            spaceLabel: spaceLabel(root.path),
            topicId: t.meta.id,
            topicTitle: t.meta.title,
            goal: t.meta.goal!,
            goalIterations: t.meta.goalIterations ?? 0,
            updatedAt: t.meta.updatedAt,
            running: runningSet.has(t.meta.id),
          })) as GlobalActiveGoal[];
        const lastKbAt = kbFiles.reduce<string>(
          (acc, f) => (f.modifiedAt > acc ? f.modifiedAt : acc),
          "",
        );
        const summary: GlobalSpaceSummary = {
          rootId: root.id,
          path: root.path,
          label: spaceLabel(root.path),
          kbFileCount: kbFiles.length,
          lastKbActivityAt: lastKbAt,
          pendingCount: pending.length,
          activeGoalsCount: activeGoals.length,
          runningAgentsCount: runningSet.size,
        };
        return { root, kbFiles, pending, activeGoals, summary };
      } catch {
        return {
          root,
          kbFiles: [],
          pending: [] as PendingInteraction[],
          activeGoals: [] as GlobalActiveGoal[],
          summary: emptySpaceSummary(root),
        };
      }
    }),
  );

  // Flatten + sort cross-space signals.
  const recentKb: GlobalRecentKbItem[] = [];
  const allPending: GlobalPending[] = [];
  const allActiveGoals: GlobalActiveGoal[] = [];
  const cutoff = Date.now() - RECENT_KB_WINDOW_MS;
  for (const { root, kbFiles, pending, activeGoals } of perRoot) {
    const label = spaceLabel(root.path);
    for (const f of kbFiles) {
      if (Date.parse(f.modifiedAt) < cutoff) continue;
      recentKb.push({
        rootId: root.id,
        spaceLabel: label,
        rel: f.rel,
        title: path.basename(f.rel),
        modifiedAt: f.modifiedAt,
      });
    }
    for (const p of pending) {
      allPending.push({ ...p, rootId: root.id, spaceLabel: label });
    }
    allActiveGoals.push(...activeGoals);
  }
  recentKb.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  const topRecent = recentKb.slice(0, RECENT_KB_LIMIT);
  // Enrich the top picks with frontmatter title/kind only — cheap.
  await Promise.all(
    topRecent.map(async (item) => {
      try {
        const root = roots.find((r) => r.id === item.rootId);
        if (!root) return;
        const abs = path.join(root.path, ".reflex", item.rel);
        const meta = await readKbMeta(abs);
        if (meta.title) item.title = meta.title;
        if (meta.kind) item.kind = meta.kind;
      } catch {
        /* keep basename fallback */
      }
    }),
  );

  allPending.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  allActiveGoals.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return {
    spaces: perRoot.map((p) => p.summary),
    recentKb: topRecent,
    activeGoals: allActiveGoals,
    pending: allPending,
    generatedAt: new Date().toISOString(),
  };
}

function spaceLabel(rootPath: string): string {
  return rootPath.split("/").filter(Boolean).pop() || rootPath;
}

function emptySpaceSummary(root: RegistryEntry): GlobalSpaceSummary {
  return {
    rootId: root.id,
    path: root.path,
    label: spaceLabel(root.path),
    kbFileCount: 0,
    lastKbActivityAt: "",
    pendingCount: 0,
    activeGoalsCount: 0,
    runningAgentsCount: 0,
  };
}
