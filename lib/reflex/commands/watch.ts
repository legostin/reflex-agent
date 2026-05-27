import chokidar from "chokidar";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { buildFlatIgnore } from "../ignore.js";
import { getBackend } from "../agents/index.js";
import { snapshotScope } from "../kb.js";
import { MIN_DEBOUNCE_MS, REFLEX_DIR, reflexRoot } from "../paths.js";

export interface WatchHandle {
  stop(): Promise<void>;
}

/**
 * Start a background watcher on `dirInput`. The agent is re-run on the root
 * scope whenever there are pending changes AND it has been at least
 * `watchDebounceMs` since the last run. Floor: 30 min (HARD_DEBOUNCE_FLOOR_MS).
 *
 * Returns a handle so callers (tests, programmatic use) can stop the watcher;
 * the CLI just lets it run until SIGINT.
 */
export async function runWatch(dirInput: string): Promise<WatchHandle> {
  const root = path.resolve(dirInput);
  await assertDir(root);
  const cfg = await loadConfig(root);

  const debounceMs = Math.max(cfg.watchDebounceMs, MIN_DEBOUNCE_MS);
  const flatIgnore = await buildFlatIgnore(root);
  const reflexAbs = reflexRoot(root);

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    // Coalesce rapid writes to the same file (atomic-save patterns, double
    // FSEvents on macOS) into a single change event.
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (p) => {
      if (p === root) return false;
      // Always exclude .reflex/ to avoid feedback loops.
      if (p === reflexAbs || p.startsWith(reflexAbs + path.sep)) return true;
      return flatIgnore(p);
    },
  });

  // Coalesce rapid bursts (writes across different files arriving back-to-back)
  // into a single trigger. The "burst window" is the quiet period after the
  // last event below which we don't consider the burst settled.
  const BURST_MS = 300;

  let lastRunAt = 0;
  let lastEventAt = 0;
  let pendingSince: number | null = null;
  let scheduled: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const schedule = () => {
    if (stopped || scheduled) return;
    const now = Date.now();
    const debounceWait = Math.max(0, lastRunAt + debounceMs - now);
    const burstWait = Math.max(0, lastEventAt + BURST_MS - now);
    const delay = Math.max(debounceWait, burstWait);
    scheduled = setTimeout(() => {
      scheduled = null;
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (stopped || running) return;
    if (pendingSince === null) return;
    const now = Date.now();
    if (
      now - lastRunAt < debounceMs ||
      now - lastEventAt < BURST_MS
    ) {
      // Either debounce or burst window not yet satisfied — re-arm.
      schedule();
      return;
    }
    running = true;
    const triggeredAt = pendingSince;
    pendingSince = null;
    try {
      const snapshot = await snapshotScope({ root, scope: root });
      process.stdout.write(
        `[reflex] change detected at ${new Date(triggeredAt).toISOString()} — refreshing KB (${snapshot.files.length} files)…\n`,
      );
      const backend = getBackend(cfg);
      await backend.analyzeScope(snapshot);
      lastRunAt = Date.now();
      process.stdout.write(`[reflex] KB refresh complete.\n`);
    } catch (err) {
      process.stderr.write(`[reflex] agent run failed: ${describeErr(err)}\n`);
      // Restore pending so we retry after the next debounce window.
      pendingSince ??= triggeredAt;
    } finally {
      running = false;
      if (pendingSince !== null) schedule();
    }
  };

  const onChange = (changedPath: string) => {
    if (stopped) return;
    if (changedPath.startsWith(reflexAbs)) return;
    lastEventAt = Date.now();
    pendingSince ??= lastEventAt;
    schedule();
  };

  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);
  watcher.on("addDir", onChange);
  watcher.on("unlinkDir", onChange);
  watcher.on("error", (err) =>
    process.stderr.write(`[reflex] watcher error: ${describeErr(err)}\n`),
  );

  process.stdout.write(
    `[reflex] watching ${root} (debounce: ${formatDuration(debounceMs)}, backend: ${cfg.agentBackend})\n`,
  );
  process.stdout.write(
    `[reflex] .reflex/ ignored to prevent feedback loops; using flat ${REFLEX_DIR}/.reflexignore view.\n`,
  );

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (scheduled) clearTimeout(scheduled);
      await watcher.close();
    },
  };
}

async function assertDir(p: string): Promise<void> {
  const stat = await fs.stat(p).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${p}`);
  }
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)} min`;
  if (ms >= 1000) return `${Math.round(ms / 1000)} s`;
  return `${ms} ms`;
}
