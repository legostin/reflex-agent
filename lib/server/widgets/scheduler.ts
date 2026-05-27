import "server-only";
import { listRoots } from "@/lib/registry";
import { agentManager } from "../agents/manager";
import { startOrchestratorTurn } from "../agents/start-turn";
import {
  listWidgets,
  writeWidget,
} from "./store";
import {
  REFRESH_CADENCE_MS,
  type WidgetRecord,
} from "./types";
import { buildRefreshPromptForWidget } from "./scheduler-bridge";

/**
 * Auto-refresh scheduler for widgets with `refresh` != "manual".
 *
 * Runs as a single setInterval on globalThis (HMR-safe — the singleton key
 * keeps a single tick across dev reloads). On each tick it scans every
 * registered root, lists widgets, and for each one that's due re-invokes
 * the orchestrator on the widget's source topic with a synthetic
 * user-message describing the current state + memory.
 *
 * Concurrency safety:
 *   - Skip a widget if its source topic already has a running agent
 *     (avoids stomping on a user's live chat).
 *   - Mark `lastRefreshAt` BEFORE firing the turn so a long-running
 *     refresh doesn't double-fire on the next tick.
 *   - Errors are logged to console, never thrown out of the interval.
 */

const TICK_MS = 5 * 60 * 1000; // 5 min
const SINGLETON_KEY = "__reflexWidgetScheduler" as const;

interface SchedulerState {
  intervalId: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  startedAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __reflexWidgetScheduler: SchedulerState | undefined;
}

function getState(): SchedulerState {
  if (!globalThis[SINGLETON_KEY]) {
    globalThis[SINGLETON_KEY] = {
      intervalId: null,
      ticking: false,
      startedAt: new Date().toISOString(),
    };
  }
  return globalThis[SINGLETON_KEY]!;
}

export function startWidgetScheduler(): void {
  const state = getState();
  if (state.intervalId) return;
  // Stagger the first tick by ~30s so a fresh dev-server start doesn't
  // hammer everything immediately while modules are still settling.
  setTimeout(() => {
    void runOnce().catch((err) => {
      console.error("[widget-scheduler] initial tick failed:", err);
    });
  }, 30_000);
  state.intervalId = setInterval(() => {
    void runOnce().catch((err) => {
      console.error("[widget-scheduler] tick failed:", err);
    });
  }, TICK_MS);
}

export function stopWidgetScheduler(): void {
  const state = getState();
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
}

async function runOnce(): Promise<void> {
  const state = getState();
  if (state.ticking) return;
  state.ticking = true;
  try {
    const roots = await listRoots();
    for (const root of roots) {
      try {
        await processRoot(root.id, root.path);
      } catch (err) {
        console.error(
          `[widget-scheduler] root ${root.id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } finally {
    state.ticking = false;
  }
}

async function processRoot(rootId: string, rootPath: string): Promise<void> {
  const widgets = await listWidgets(rootPath);
  for (const w of widgets) {
    if (!isDue(w)) continue;
    if (!w.sourceTopicId) continue;
    // Don't stomp a live conversation.
    if (agentManager.isActive(w.sourceTopicId)) continue;
    await refreshOne(rootId, rootPath, w);
  }
}

export function isDue(w: WidgetRecord): boolean {
  if (!w.refresh || w.refresh === "manual") return false;
  const cadence = REFRESH_CADENCE_MS[w.refresh];
  if (!cadence) return false;
  const last = w.lastRefreshAt ?? w.updatedAt;
  const since = Date.now() - Date.parse(last);
  return Number.isFinite(since) && since >= cadence;
}

async function refreshOne(
  rootId: string,
  rootPath: string,
  widget: WidgetRecord,
): Promise<void> {
  // Stamp lastRefreshAt BEFORE firing so we don't double-fire if the turn
  // takes longer than a tick interval. On agent failure the user can still
  // re-trigger manually from the UI.
  const stamped: WidgetRecord = {
    ...widget,
    lastRefreshAt: new Date().toISOString(),
  };
  await writeWidget(rootPath, stamped);
  const message = await buildRefreshPromptForWidget(rootPath, stamped);
  const res = await startOrchestratorTurn({
    rootId,
    topicId: widget.sourceTopicId!,
    message,
    attachments: [],
  });
  if ("error" in res) {
    console.error(
      `[widget-scheduler] couldn't start refresh for ${widget.id}: ${res.error}`,
    );
  }
}

// buildRefreshPromptForWidget moved to scheduler-bridge.ts so both the
// auto-scheduler and the manual "Refresh now" action can reuse it.
