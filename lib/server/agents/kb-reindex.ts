import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { reflexRoot } from "@/lib/reflex/paths";

/**
 * Lightweight KB re-indexer.
 *
 * Agents create files via the Write tool (not always through the
 * `<<reflex:kb>>` directive). Without intervention those files exist on
 * disk but aren't reachable from the human-facing KB tree:
 *   - the parent `INDEX.md` doesn't reference them, and
 *   - the UI's sidebar/file-list was cached at page load.
 *
 * This module captures a snapshot of every `.md` file under `<root>/.reflex/`
 * (minus `topics/`) before the agent runs, then diffs after the turn. For
 * each new file the parent INDEX.md gets a one-line entry appended — enough
 * for the agent's *next* turn to discover the file via the existing KB list,
 * and for the user to navigate to it.
 */

const TOPICS_DIR = "topics";
const ATTACHMENTS_DIR = "attachments";
const SKIP_DIRS = new Set([TOPICS_DIR, ATTACHMENTS_DIR, "data", "audit"]);

export interface KbSnapshot {
  /** abs-path → mtime epoch ms. */
  files: Map<string, number>;
}

export interface NewKbFile {
  /** Absolute path. */
  abs: string;
  /** Path relative to `<root>/.reflex/` (POSIX). */
  rel: string;
  /** Best-effort metadata pulled from frontmatter. */
  title?: string;
  kind?: string;
}

export async function snapshotKb(rootPath: string): Promise<KbSnapshot> {
  const dir = reflexRoot(rootPath);
  const files = new Map<string, number>();
  await walk(dir, dir, files);
  return { files };
}

/**
 * Returns files that appeared (path is new) OR were modified (mtime moved
 * forward) since the snapshot. Treats both as "needs (re-)indexing".
 */
export async function diffKb(
  rootPath: string,
  before: KbSnapshot,
): Promise<NewKbFile[]> {
  const dir = reflexRoot(rootPath);
  const after = new Map<string, number>();
  await walk(dir, dir, after);
  const out: NewKbFile[] = [];
  for (const [abs, mtime] of after) {
    const prev = before.files.get(abs);
    if (prev !== undefined && prev >= mtime) continue;
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    out.push({ abs, rel, ...(await frontmatterHints(abs)) });
  }
  return out;
}

/**
 * For each new/modified KB file, append a one-line bullet to its parent
 * `INDEX.md` if one isn't already present. Creates the parent INDEX.md if
 * missing. Returns the list of INDEX.md files actually touched, so the
 * caller can surface them in the audit / event stream.
 */
export async function reindexNewFiles(
  rootPath: string,
  files: NewKbFile[],
): Promise<string[]> {
  const dir = reflexRoot(rootPath);
  const touched = new Set<string>();
  for (const f of files) {
    // Never index the index file itself.
    if (path.basename(f.abs).toLowerCase() === "index.md") continue;
    const parent = path.dirname(f.abs);
    const indexPath = path.join(parent, "INDEX.md");
    const indexExists = await fileExists(indexPath);
    const name = path.basename(f.abs);
    const label = f.title ?? name.replace(/\.md$/, "");
    const kindBadge = f.kind ? ` _(${f.kind})_` : "";
    const newLine = `- [${label}](./${name})${kindBadge}`;
    let body = indexExists ? await fs.readFile(indexPath, "utf8") : "";
    if (alreadyMentioned(body, name)) continue;
    if (!indexExists) {
      const relDir = path.relative(dir, parent) || ".";
      body = `# ${relDir}\n\nAuto-generated index. Edit freely — Reflex only appends new entries below.\n\n## Files\n\n`;
    } else if (!/\n## Files\b/i.test(body)) {
      body = body.trimEnd() + "\n\n## Files\n\n";
    } else if (!body.endsWith("\n")) {
      body += "\n";
    }
    body += newLine + "\n";
    await fs.writeFile(indexPath, body, "utf8");
    touched.add(indexPath);
  }
  return [...touched];
}

async function walk(
  base: string,
  dir: string,
  out: Map<string, number>,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (dir === base && SKIP_DIRS.has(e.name)) continue;
      if (e.name === "utilities") continue;
      await walk(base, path.join(dir, e.name), out);
      continue;
    }
    if (!e.name.toLowerCase().endsWith(".md")) continue;
    const abs = path.join(dir, e.name);
    try {
      const stat = await fs.stat(abs);
      out.set(abs, stat.mtimeMs);
    } catch {
      // ignore unreadable files
    }
  }
}

async function frontmatterHints(
  abs: string,
): Promise<{ title?: string; kind?: string }> {
  try {
    const raw = await fs.readFile(abs, "utf8");
    if (!raw.startsWith("---")) return {};
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const out: { title?: string; kind?: string } = {};
    if (typeof data.title === "string") out.title = data.title;
    if (typeof data.kind === "string") out.kind = data.kind;
    return out;
  } catch {
    return {};
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function alreadyMentioned(body: string, filename: string): boolean {
  // Cheap: look for any link `(./<name>)` or `](<name>)` already in the doc.
  const safe = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`]\\(\\.?/?${safe}\\)`);
  return re.test(body);
}
