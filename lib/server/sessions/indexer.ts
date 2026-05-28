import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { listRoots, type RegistryEntry } from "@/lib/registry";
import { reflexRoot } from "@/lib/reflex/paths";
import { getDb } from "./db";

/**
 * Incremental indexer for journal and topic transcripts.
 *
 * Walk strategy:
 *  - For each registered root, list `.reflex/journal/*.md` and
 *    `.reflex/topics/*.md`.
 *  - For each file, compare on-disk mtime to the cached one in
 *    `documents`. If newer (or absent), re-parse + re-index.
 *  - File deletions are NOT detected here — see `pruneMissing()`.
 *
 * Topic files alternate `## user` / `## assistant` sections. We
 * concatenate the body verbatim — the FTS5 tokenizer handles natural
 * language fine and over-segmenting by turn just multiplies row count
 * without improving recall.
 */

export interface IndexResult {
  scanned: number;
  upserted: number;
  removed: number;
}

const JOURNAL_DIR = "journal";
const TOPICS_DIR = "topics";

export async function indexAllSessions(): Promise<IndexResult> {
  const roots = await listRoots().catch(() => [] as RegistryEntry[]);
  let scanned = 0;
  let upserted = 0;
  let removed = 0;
  const seen = new Set<string>();
  for (const root of roots) {
    const res = await indexRoot(root, seen);
    scanned += res.scanned;
    upserted += res.upserted;
  }
  removed = await pruneMissing(seen);
  return { scanned, upserted, removed };
}

async function indexRoot(
  root: RegistryEntry,
  seen: Set<string>,
): Promise<{ scanned: number; upserted: number }> {
  const reflexDir = reflexRoot(root.path);
  let scanned = 0;
  let upserted = 0;

  for (const { dir, source } of [
    { dir: JOURNAL_DIR, source: "journal" as const },
    { dir: TOPICS_DIR, source: "topic" as const },
  ]) {
    const absDir = path.join(reflexDir, dir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
      const abs = path.join(absDir, e.name);
      seen.add(abs);
      scanned++;
      const upserted_ = await maybeIndexFile({
        absPath: abs,
        rootId: root.id,
        rootPath: root.path,
        source,
        ref: e.name.replace(/\.md$/i, ""),
      });
      if (upserted_) upserted++;
    }
  }
  return { scanned, upserted };
}

interface IndexFileArgs {
  absPath: string;
  rootId: string;
  rootPath: string;
  source: "journal" | "topic";
  ref: string;
}

async function maybeIndexFile(args: IndexFileArgs): Promise<boolean> {
  const stat = await fs.stat(args.absPath).catch(() => null);
  if (!stat) return false;
  const mtimeMs = Math.floor(stat.mtimeMs);

  const handle = await getDb();
  if (!handle) return false;
  const db = handle.raw;
  const existing = db
    .prepare(
      "SELECT id, mtime_ms FROM documents WHERE file_path = ? LIMIT 1",
    )
    .get(args.absPath) as { id: number; mtime_ms: number } | undefined;
  if (existing && existing.mtime_ms === mtimeMs) return false;

  let raw: string;
  try {
    raw = await fs.readFile(args.absPath, "utf8");
  } catch {
    return false;
  }
  const parsed = matter(raw);
  const meta = parsed.data as Record<string, unknown>;
  const title =
    (typeof meta.title === "string" && meta.title.trim()) ||
    deriveTitleFromBody(parsed.content) ||
    args.ref;
  const isoDate =
    (typeof meta.date === "string" && meta.date.trim()) ||
    (typeof meta.createdAt === "string" && meta.createdAt.trim()) ||
    deriveDateFromRef(args.ref) ||
    null;
  const body = stripTurnHeadings(parsed.content).trim();
  if (!body) {
    if (existing) await deleteRow(existing.id);
    return false;
  }

  const now = Date.now();
  if (existing) {
    db.prepare(
      `UPDATE documents
         SET source = ?, root_id = ?, root_path = ?, ref = ?, title = ?,
             iso_date = ?, mtime_ms = ?, indexed_at = ?
       WHERE id = ?`,
    ).run(
      args.source,
      args.rootId,
      args.rootPath,
      args.ref,
      title,
      isoDate,
      mtimeMs,
      now,
      existing.id,
    );
    db.prepare("DELETE FROM documents_fts WHERE rowid = ?").run(existing.id);
    db.prepare(
      "INSERT INTO documents_fts (rowid, title, body) VALUES (?, ?, ?)",
    ).run(existing.id, title, body);
  } else {
    const info = db
      .prepare(
        `INSERT INTO documents (source, root_id, root_path, ref, file_path,
                                title, iso_date, mtime_ms, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.source,
        args.rootId,
        args.rootPath,
        args.ref,
        args.absPath,
        title,
        isoDate,
        mtimeMs,
        now,
      );
    const rowid = Number(info.lastInsertRowid);
    db.prepare(
      "INSERT INTO documents_fts (rowid, title, body) VALUES (?, ?, ?)",
    ).run(rowid, title, body);
  }
  return true;
}

async function deleteRow(id: number): Promise<void> {
  const handle = await getDb();
  if (!handle) return;
  const db = handle.raw;
  db.prepare("DELETE FROM documents_fts WHERE rowid = ?").run(id);
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

async function pruneMissing(seen: Set<string>): Promise<number> {
  const handle = await getDb();
  if (!handle) return 0;
  const db = handle.raw;
  const rows = db.prepare("SELECT id, file_path FROM documents").all() as {
    id: number;
    file_path: string;
  }[];
  let removed = 0;
  for (const r of rows) {
    if (!seen.has(r.file_path)) {
      db.prepare("DELETE FROM documents_fts WHERE rowid = ?").run(r.id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(r.id);
      removed++;
    }
  }
  return removed;
}

function deriveTitleFromBody(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^##\s+(user|assistant)/i.test(line)) continue;
    return line.replace(/^#+\s*/, "").slice(0, 80);
  }
  return null;
}

function deriveDateFromRef(ref: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ref);
  return m ? m[1]! : null;
}

function stripTurnHeadings(body: string): string {
  return body.replace(/^##\s+(user|assistant)\s*$/gim, "\n");
}
