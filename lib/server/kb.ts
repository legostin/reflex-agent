import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { REFLEX_DIR, reflexRoot } from "@/lib/reflex/paths";

const TOPICS_DIR = "topics";

export interface KbFileMeta {
  title?: string;
  version?: string | number;
  date?: string;
  /** Entity type: `fact` | `task` | `meeting` | `product` | … */
  kind?: string;
  /** Raw frontmatter — used by the viewer to render typed entity badges. */
  data: Record<string, unknown>;
}

/**
 * Cheap shape: just enough to populate trees, count, and sort by mtime.
 * `meta` is null until frontmatter is explicitly requested via
 * `parseFrontmatter()` or via `listKbFiles()` (which parses all).
 */
export interface KbFileShallow {
  rel: string;
  abs: string;
  size: number;
  modifiedAt: string;
}

export interface KbFile extends KbFileShallow {
  meta: KbFileMeta;
}

export interface KbStats {
  exists: boolean;
  fileCount: number;
  totalBytes: number;
}

/**
 * Stat-only walk. Returns every `.md` under `.reflex/` with size + mtime
 * but does NOT read any file contents. Cheap — used as the foundation
 * for `kbStats`, `listKbFilesShallow`, and the dashboard's recent-kb
 * picker (which only parses frontmatter for the top 6).
 */
export async function walkKbMarkdown(
  root: string,
): Promise<KbFileShallow[]> {
  const dir = reflexRoot(root);
  return collectShallow(dir, dir);
}

export async function kbStats(root: string): Promise<KbStats> {
  const dir = reflexRoot(root);
  try {
    const files = await collectShallow(dir, dir);
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    return { exists: true, fileCount: files.length, totalBytes };
  } catch {
    return { exists: false, fileCount: 0, totalBytes: 0 };
  }
}

/**
 * Full list with frontmatter for every file. Use sparingly — for a
 * project with N files this is N readFile + gray-matter parse. Most
 * callers only need the cheap shallow walk.
 */
export async function listKbFiles(root: string): Promise<KbFile[]> {
  const shallow = await walkKbMarkdown(root);
  // Parallelize — node can keep many fds open and parsing is CPU-bound
  // but small per file.
  const enriched = await Promise.all(
    shallow.map(async (f) => ({
      ...f,
      meta: await safeParseFrontmatter(f.abs),
    })),
  );
  return enriched;
}

export async function listKbFilesShallow(
  root: string,
): Promise<KbFileShallow[]> {
  return walkKbMarkdown(root);
}

/**
 * Parse frontmatter for one specific file. Used when we need title/kind
 * for a single open file without paying for the full tree walk.
 */
export async function readKbMeta(absPath: string): Promise<KbFileMeta> {
  return safeParseFrontmatter(absPath);
}

export async function readKbFile(
  root: string,
  rel: string,
): Promise<string> {
  const dir = reflexRoot(root);
  const target = path.resolve(dir, rel);
  // Prevent path traversal outside .reflex/.
  const relCheck = path.relative(dir, target);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error(`Refused to read outside ${REFLEX_DIR}: ${rel}`);
  }
  return fs.readFile(target, "utf8");
}

async function collectShallow(
  baseDir: string,
  dir: string,
): Promise<KbFileShallow[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // Walk subdirectories in parallel — every dir-level fan-out cuts
  // wall-clock time roughly linearly with depth.
  const dirPromises: Promise<KbFileShallow[]>[] = [];
  const files: KbFileShallow[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Hide the topics/ folder from the KB tree — chats live there.
      if (dir === baseDir && e.name === TOPICS_DIR) continue;
      dirPromises.push(collectShallow(baseDir, abs));
      continue;
    }
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".md")) continue;
    // Defer stat until after we're done filtering — saves syscalls on
    // non-md files.
    files.push({
      rel: path.relative(baseDir, abs).split(path.sep).join("/"),
      abs,
      size: 0,
      modifiedAt: "",
    });
  }
  // Stat all collected files in parallel.
  const statted = await Promise.all(
    files.map(async (f) => {
      try {
        const s = await fs.stat(f.abs);
        return { ...f, size: s.size, modifiedAt: s.mtime.toISOString() };
      } catch {
        return f;
      }
    }),
  );
  // Await subdir walks.
  const subResults = await Promise.all(dirPromises);
  const out: KbFileShallow[] = statted;
  for (const r of subResults) out.push(...r);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

async function safeParseFrontmatter(abs: string): Promise<KbFileMeta> {
  try {
    const raw = await fs.readFile(abs, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    return {
      ...(stringOrUndef(data.title) !== undefined
        ? { title: stringOrUndef(data.title) }
        : {}),
      ...(stringOrNumberOrUndef(data.version) !== undefined
        ? { version: stringOrNumberOrUndef(data.version) }
        : {}),
      ...(stringOrUndef(data.date) !== undefined
        ? { date: stringOrUndef(data.date) }
        : {}),
      ...(stringOrUndef(data.kind) !== undefined
        ? { kind: stringOrUndef(data.kind) }
        : {}),
      data,
    };
  } catch {
    return { data: {} };
  }
}

function stringOrUndef(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return undefined;
}

function stringOrNumberOrUndef(v: unknown): string | number | undefined {
  if (typeof v === "string" || typeof v === "number") return v;
  return undefined;
}
