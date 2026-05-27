import { promises as fs } from "node:fs";
import path from "node:path";
import { IgnoreStack } from "./ignore.js";

export interface WalkEntry {
  /** Absolute path. */
  abs: string;
  /** Path relative to the walk root (POSIX-style separators). */
  rel: string;
  /** True for directories. */
  isDir: boolean;
}

export interface WalkOptions {
  /** Maximum recursion depth (root = 0). Default: unlimited. */
  maxDepth?: number;
  /** Follow symlinks. Default: false. */
  followSymlinks?: boolean;
}

/**
 * Walk `root` honoring nested `.reflexignore` files and a default prune list.
 * Yields both directories and files so callers can drive per-dir analysis.
 */
export async function* walk(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry, void, void> {
  const { maxDepth = Infinity, followSymlinks = false } = options;
  const rootAbs = path.resolve(root);
  const initialStack = await IgnoreStack.create(rootAbs);
  yield { abs: rootAbs, rel: ".", isDir: true };
  yield* descend(rootAbs, rootAbs, initialStack, 0, maxDepth, followSymlinks);
}

async function* descend(
  root: string,
  dir: string,
  stack: IgnoreStack,
  depth: number,
  maxDepth: number,
  followSymlinks: boolean,
): AsyncGenerator<WalkEntry, void, void> {
  if (depth >= maxDepth) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (stack.ignores(abs)) continue;
    const isSymlink = e.isSymbolicLink();
    if (isSymlink && !followSymlinks) continue;
    const isDir = e.isDirectory() || (isSymlink && (await isLinkedDir(abs)));
    const rel = posixRel(root, abs);
    yield { abs, rel, isDir };
    if (isDir) {
      const child = await stack.enter(abs);
      yield* descend(root, abs, child, depth + 1, maxDepth, followSymlinks);
    }
  }
}

async function isLinkedDir(abs: string): Promise<boolean> {
  try {
    const s = await fs.stat(abs);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function posixRel(root: string, abs: string): string {
  const r = path.relative(root, abs);
  return r.split(path.sep).join("/");
}
