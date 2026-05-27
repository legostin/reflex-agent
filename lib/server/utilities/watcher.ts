import "server-only";
import { EventEmitter } from "node:events";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import {
  globalUtilitiesDir,
  listUtilities,
  projectUtilitiesDir,
} from "./store";
import { buildUtility } from "./build";
import { appendAudit } from "./audit";
import type { UtilityScope } from "./types";
import { listRoots } from "@/lib/registry";

/**
 * Watch every utility directory on disk and rebuild on changes. Singleton on
 * globalThis so dev HMR doesn't double-watch.
 *
 * Events:
 *   utility-changed  { id, scope }
 *   utility-removed  { id, scope }
 */

const DEBOUNCE_MS = 500;

interface WatcherState {
  emitter: EventEmitter;
  watcher?: FSWatcher;
  /** map: dir → debounce timer */
  timers: Map<string, NodeJS.Timeout>;
  started: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __reflexUtilityWatcher: WatcherState | undefined;
}

const state: WatcherState =
  globalThis.__reflexUtilityWatcher ??
  ({
    emitter: new EventEmitter(),
    timers: new Map(),
    started: false,
  } satisfies WatcherState);
globalThis.__reflexUtilityWatcher = state;

export function utilityEvents(): EventEmitter {
  return state.emitter;
}

export async function ensureWatcherStarted(): Promise<void> {
  if (state.started) return;
  state.started = true;
  const dirs = await collectWatchDirs();
  state.watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    depth: 4,
    ignored: (p: string) => p.includes("/data/") || p.endsWith("bundle.js"),
  });
  state.watcher.on("all", (_event, filePath: string) => {
    const meta = findUtilityFromPath(filePath);
    if (!meta) return;
    queueRebuild(meta);
  });
}

async function collectWatchDirs(): Promise<string[]> {
  const out = [globalUtilitiesDir()];
  try {
    const roots = await listRoots();
    for (const r of roots) out.push(projectUtilitiesDir(r.path));
  } catch {
    // ignore
  }
  return out;
}

interface ChangedUtility {
  id: string;
  scope: UtilityScope;
  rootId?: string;
}

function findUtilityFromPath(filePath: string): ChangedUtility | null {
  // The watched paths look like:
  //   <home>/.reflex/utilities/<id>/...
  //   <root>/.reflex/utilities/<id>/...
  const segs = filePath.split(path.sep);
  const idx = segs.lastIndexOf("utilities");
  if (idx < 0 || idx + 1 >= segs.length) return null;
  const id = segs[idx + 1];
  if (!id) return null;
  const parent = segs.slice(0, idx).join(path.sep);
  const isGlobal = parent.endsWith(path.join(".reflex"));
  if (isGlobal && parent === path.join(require("node:os").homedir(), ".reflex")) {
    return { id, scope: "global" };
  }
  // project scope — caller would need rootId; we leave it undefined here, the
  // build call doesn't actually need rootId because we look up by dir.
  return { id, scope: "project" };
}

function queueRebuild(meta: ChangedUtility): void {
  const key = `${meta.scope}:${meta.id}`;
  const existing = state.timers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    state.timers.delete(key);
    void rebuildOne(meta);
  }, DEBOUNCE_MS);
  state.timers.set(key, t);
}

async function rebuildOne(meta: ChangedUtility): Promise<void> {
  try {
    const utilities = await listUtilities({ scope: meta.scope });
    const target = utilities.find((u) => u.manifest.id === meta.id);
    if (!target) {
      state.emitter.emit("utility-removed", meta);
      return;
    }
    await buildUtility(target);
    await appendAudit({
      ts: new Date().toISOString(),
      utilityId: meta.id,
      scope: meta.scope,
      channel: "system",
      method: "utility.rebuild",
      phase: "end",
      correlationId: "watcher",
    });
    state.emitter.emit("utility-changed", { ...meta });
  } catch (err) {
    await appendAudit({
      ts: new Date().toISOString(),
      utilityId: meta.id,
      scope: meta.scope,
      channel: "system",
      method: "utility.rebuild",
      phase: "end",
      correlationId: "watcher",
      error: err instanceof Error ? err.message : String(err),
    });
    state.emitter.emit("utility-rebuild-failed", {
      ...meta,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
