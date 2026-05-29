import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Atomic JSON file persistence for the SpaceStore (north-star Layer 1).
 *
 * Two guarantees the ad-hoc `fs.writeFile(JSON.stringify(...))` calls scattered
 * across the codebase lacked:
 *
 *  1. ATOMIC writes — serialize to a sibling `.tmp` then `fs.rename` over the
 *     target. rename is atomic on POSIX, so a crash mid-write never leaves a
 *     truncated/corrupt file (the old contents survive intact).
 *  2. Per-file SERIALIZATION — a globalThis-guarded mutex chains writes to the
 *     same path. Atomic rename alone doesn't stop two concurrent
 *     read-modify-write cycles from clobbering each other (last writer wins);
 *     the lock makes them queue.
 *
 * `mode` sets file permissions (e.g. `0o600` for credential stores). Pure +
 * dependency-free so it sits at the bottom of the import-direction graph and
 * works under both the app and CLI tsconfigs.
 */

declare global {
  // eslint-disable-next-line no-var
  var __reflexJsonStoreLocks: Map<string, Promise<unknown>> | undefined;
}
const locks: Map<string, Promise<unknown>> = (globalThis.__reflexJsonStoreLocks ??=
  new Map());

/** Run `fn` after any in-flight write to `file` settles (success or failure). */
export function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(file) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Track a non-throwing tail so a rejected write can't wedge the chain.
  locks.set(file, next.then(noop, noop));
  return next;
}

function noop(): void {}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

/** Read + JSON.parse a file, or `null` if it doesn't exist. Throws on other IO
 *  / parse errors so corruption is surfaced, not silently swallowed. */
export async function readJsonFile<T = unknown>(
  file: string,
): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return JSON.parse(raw) as T;
}

export interface WriteJsonOptions {
  /** File mode, e.g. 0o600 for credential stores. */
  mode?: number;
}

/** Atomically write a value as pretty JSON (tmp + rename), serialized per file. */
export async function writeJsonFile(
  file: string,
  value: unknown,
  opts: WriteJsonOptions = {},
): Promise<void> {
  await withFileLock(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`; // unique under the per-file lock (one writer)
    const body = JSON.stringify(value, null, 2) + "\n";
    await fs.writeFile(tmp, body, {
      encoding: "utf8",
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    });
    // Re-assert mode in case umask masked it on create.
    if (opts.mode !== undefined) await fs.chmod(tmp, opts.mode);
    await fs.rename(tmp, file);
  });
}
