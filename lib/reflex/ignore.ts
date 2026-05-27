import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { DEFAULT_PRUNE, REFLEX_IGNORE } from "./paths.js";

/**
 * Hierarchical .reflexignore matcher. Each directory may carry its own
 * `.reflexignore` file (gitignore syntax). Patterns from a directory apply to
 * that subtree only — like git's nested .gitignore behavior.
 *
 * Use {@link IgnoreStack#enter} when descending into a subdir and discard the
 * returned stack when leaving (immutable push).
 */
export class IgnoreStack {
  private constructor(
    private readonly root: string,
    private readonly layers: ReadonlyArray<{ dir: string; ig: Ignore }>,
  ) {}

  static async create(root: string): Promise<IgnoreStack> {
    const empty = new IgnoreStack(root, []);
    return empty.enter(root);
  }

  /** Push a layer for `dir` (absolute) if it contains a .reflexignore. */
  async enter(dir: string): Promise<IgnoreStack> {
    const file = path.join(dir, REFLEX_IGNORE);
    let body: string;
    try {
      body = await fs.readFile(file, "utf8");
    } catch {
      return this;
    }
    const ig = ignore().add(body);
    return new IgnoreStack(this.root, [...this.layers, { dir, ig }]);
  }

  /** True if `abs` (file or dir) is ignored under any active layer. */
  ignores(abs: string): boolean {
    const base = path.basename(abs);
    if (DEFAULT_PRUNE.has(base)) return true;
    for (const { dir, ig } of this.layers) {
      const rel = path.relative(dir, abs);
      if (!rel || rel.startsWith("..")) continue;
      if (ig.ignores(rel)) return true;
    }
    return false;
  }
}

/**
 * Build a flat ignore predicate that incorporates every `.reflexignore` file
 * found anywhere under `root`. Use this when you cannot walk hierarchically
 * (e.g., handing a single function to a watcher).
 */
export async function buildFlatIgnore(
  root: string,
): Promise<(abs: string) => boolean> {
  const { promises: fs } = await import("node:fs");
  let stack = await IgnoreStack.create(root);
  // Walk synchronously here so the predicate is ready before the caller starts
  // its watcher. Avoid importing walker.ts to keep ignore.ts dependency-light.
  async function descend(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      if (stack.ignores(abs)) continue;
      stack = await stack.enter(abs);
      await descend(abs);
    }
  }
  await descend(root);
  return (abs: string) => stack.ignores(abs);
}
