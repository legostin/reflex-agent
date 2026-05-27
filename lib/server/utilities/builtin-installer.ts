import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ManifestSchema, type UtilityScope } from "./types";
import { installUtility } from "./store";
import { buildUtility } from "./build";

/**
 * Install a utility from the local `packages/utilities/<id>/` directory.
 *
 * Why bother: the curated catalogue ships with a baseline of utilities
 * we want users to have on day 1, even with no internet and no public
 * github repos yet. The `builtin:<id>@<version>` scheme covers exactly
 * this case — same on-disk install layout as github (so the rest of
 * the system doesn't care), but the file source is the Reflex repo
 * itself.
 *
 * Once any individual builtin gets published as a real github repo,
 * the curated entry just switches its `github` field from
 * `builtin:<id>@<ver>` to `github:<owner>/<repo>@<tag>` and the install
 * path silently routes through GitHub instead. Already-installed users
 * keep working — utility id stays the same.
 */

export interface BuiltinInstallSpec {
  builtin: string; // e.g. "builtin:finance-pro@0.1.0"
  scope: UtilityScope;
  rootId?: string;
}

export interface BuiltinInstallResult {
  scope: UtilityScope;
  id: string;
  origin: string;
}

const SPEC_RE = /^builtin:([a-z][a-z0-9-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.]+)?)$/;

/**
 * Files Reflex looks for in `packages/utilities/<id>/`. Everything but
 * `manifest.json` is optional — we materialize whatever's there and
 * trust the build step to fail if `ui.tsx` is required and missing.
 */
const KNOWN_FILES = [
  "manifest.json",
  "ui.tsx",
  "card.tsx",
  "README.md",
  "icon.png",
];

export function isBuiltinSpec(spec: string): boolean {
  return SPEC_RE.test(spec);
}

export async function installFromBuiltin(
  spec: BuiltinInstallSpec,
): Promise<BuiltinInstallResult> {
  const m = SPEC_RE.exec(spec.builtin);
  if (!m) {
    throw new Error(`Invalid builtin spec: ${spec.builtin}`);
  }
  const id = m[1]!;
  const version = m[2]!;
  const pkgDir = path.join(repoRoot(), "packages", "utilities", id);
  const stat = await fs.stat(pkgDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(
      `Builtin utility "${id}" not found at ${pkgDir}. Did the repo include packages/utilities/?`,
    );
  }

  // Read manifest first so we know which extra files (serverActions) to grab.
  const manifestPath = path.join(pkgDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error(
      `manifest.json in ${pkgDir} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const manifest = ManifestSchema.parse(manifestJson);
  if (manifest.id !== id) {
    throw new Error(
      `manifest.id (${manifest.id}) doesn't match directory name (${id})`,
    );
  }
  if (manifest.version !== version) {
    // Allow mismatch (manifest source of truth wins) but warn.
    console.warn(
      `[builtin-installer] version mismatch: spec=${version} manifest=${manifest.version} — using manifest version`,
    );
  }

  // Build the file map. Manifest first, then known shells (ui/card/...),
  // then everything under `actions/` (so shared helpers like `_json.ts`
  // come along with the listed entry points), and finally any other
  // top-level .ts/.tsx/.mjs/.js/.css files the utility ships (covers
  // shared components like `article-view.tsx` that `ui.tsx` imports
  // relatively).
  const files: Record<string, string> = {};
  files["manifest.json"] = manifestRaw;
  for (const rel of KNOWN_FILES) {
    if (rel === "manifest.json") continue;
    const abs = path.join(pkgDir, rel);
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content != null) files[rel] = content;
  }
  // Pull every file under `actions/` recursively — covers helpers
  // imported transitively by serverActions[].entry.
  const actionsDir = path.join(pkgDir, "actions");
  await collectDir(actionsDir, actionsDir, "actions", files);
  // Top-level source files. Skip dirs (recursed into actions/ above)
  // and files already captured. Keeps shared UI components reachable.
  const topEntries = await fs
    .readdir(pkgDir, { withFileTypes: true })
    .catch(() => [] as import("node:fs").Dirent[]);
  for (const e of topEntries) {
    if (!e.isFile()) continue;
    if (files[e.name] !== undefined) continue;
    if (!/\.(tsx?|mjs|js|css|md)$/i.test(e.name)) continue;
    const abs = path.join(pkgDir, e.name);
    try {
      const stat = await fs.stat(abs);
      if (stat.size > 512 * 1024) continue;
    } catch {
      continue;
    }
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content != null) files[e.name] = content;
  }

  for (const a of manifest.serverActions ?? []) {
    if (files[a.entry] !== undefined) continue;
    const abs = path.join(pkgDir, a.entry);
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content == null) {
      throw new Error(
        `serverAction entry "${a.entry}" missing in ${pkgDir}`,
      );
    }
    files[a.entry] = content;
  }

  const origin = `builtin:${manifest.id}@${manifest.version}`;
  const installed = await installUtility({
    scope: spec.scope,
    ...(spec.rootId ? { rootId: spec.rootId } : {}),
    manifest,
    files,
    source: {
      type: "builtin",
      origin,
      fetchedAt: new Date().toISOString(),
      installedBy: "builtin-installer",
    },
  });
  await buildUtility(installed);
  return { scope: installed.scope, id: installed.manifest.id, origin };
}

/**
 * Resolve the absolute path of the Reflex repo root. We're always
 * loaded from `lib/server/utilities/builtin-installer.ts`, so the repo
 * root is three levels up from `__dirname` at runtime — but Next.js
 * bundles us with no __dirname, so use process.cwd() instead. Next dev
 * + build both set cwd to the repo root.
 */
function repoRoot(): string {
  return process.cwd();
}

/**
 * Walk a source subtree and stuff every text-like file into `files`
 * keyed by `<relPrefix>/<...>`. Silently skips on missing dir so
 * utilities without an `actions/` folder still install.
 */
async function collectDir(
  baseDir: string,
  curDir: string,
  relPrefix: string,
  files: Record<string, string>,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(curDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(curDir, e.name);
    const rel = relPrefix
      ? `${relPrefix}/${path.relative(baseDir, abs).split(path.sep).join("/")}`
      : path.relative(baseDir, abs).split(path.sep).join("/");
    if (e.isDirectory()) {
      await collectDir(baseDir, abs, relPrefix, files);
      continue;
    }
    if (!e.isFile()) continue;
    // Skip anything that's clearly non-source (size cap as belt-and-braces).
    try {
      const stat = await fs.stat(abs);
      if (stat.size > 512 * 1024) continue;
    } catch {
      continue;
    }
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content == null) continue;
    if (files[rel] !== undefined) continue;
    files[rel] = content;
  }
}
