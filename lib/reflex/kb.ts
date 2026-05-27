import { promises as fs } from "node:fs";
import path from "node:path";
import { walk } from "./walker.js";
import { mirrorInReflex, REFLEX_DIR, REFLEX_IGNORE } from "./paths.js";

export interface ScopeSnapshot {
  /** Absolute path of the project root. */
  root: string;
  /** Absolute path of the scope (may equal root). */
  scope: string;
  /** Absolute path of the mirroring directory inside .reflex/. */
  reflexScope: string;
  /** Files visible under the scope after ignore filtering, relative to scope (POSIX). */
  files: string[];
}

/** Collect a snapshot of files visible under `scope` (honoring .reflexignore). */
export async function snapshotScope(args: {
  root: string;
  scope: string;
}): Promise<ScopeSnapshot> {
  const root = path.resolve(args.root);
  const scope = path.resolve(args.scope);
  const relScope = path.relative(root, scope);
  if (relScope.startsWith("..")) {
    throw new Error(`Scope ${scope} is outside root ${root}`);
  }
  const reflexScope = relScope
    ? mirrorInReflex(root, relScope)
    : path.join(root, REFLEX_DIR);

  const files: string[] = [];
  for await (const entry of walk(scope)) {
    if (entry.rel === ".") continue;
    if (!entry.isDir) files.push(entry.rel);
  }
  return { root, scope, reflexScope, files };
}

export async function ensureReflexIgnoreTemplate(root: string): Promise<void> {
  const target = path.join(root, REFLEX_IGNORE);
  try {
    await fs.access(target);
    return;
  } catch {
    // not present — write a sane default
  }
  const body = [
    "# .reflexignore — gitignore syntax",
    "# Patterns listed here are excluded from Reflex's analysis and watchers.",
    "",
    "node_modules/",
    "dist/",
    "build/",
    ".venv/",
    "__pycache__/",
    "*.log",
    "",
  ].join("\n");
  await fs.writeFile(target, body, "utf8");
}
