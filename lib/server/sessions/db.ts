import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { reflexHome } from "@/lib/reflex/home";

// Type-only — erased at compile, emits no runtime require. The actual
// module is imported lazily in getDb() so that (a) `next build` never
// evaluates node:sqlite while collecting page data and (b) runtimes that
// predate the built-in (Node < 22.5) degrade gracefully instead of
// crashing the whole app at import time.
type DatabaseSync = import("node:sqlite").DatabaseSync;

/**
 * SQLite FTS5 index over the user's journal + topic transcripts, across
 * every registered Space. One DB for the whole Reflex install — it lives
 * next to settings.json so it survives across Space additions/removals
 * and isn't bound to any single project.
 *
 * The schema is deliberately small:
 *
 *   documents          — one row per indexed file, with mtime so we can
 *                        re-index incrementally
 *   documents_fts      — FTS5 virtual table over (title, body) with
 *                        unicode61 tokenizer + porter stemming. Snippet
 *                        + bm25 ranking come from FTS5 directly.
 *
 * We use the SYNCHRONOUS DatabaseSync API on purpose: SQLite I/O is
 * fast, and a synchronous API keeps the indexer + search code linear.
 * The whole thing is one process anyway — no cross-thread contention.
 *
 * `node:sqlite` is experimental in Node 24 but stable enough for an
 * append-only search index. If the API changes we update one file.
 */

const SCHEMA_VERSION = 1;

let _db: DatabaseSync | null = null;
let _initialized = false;

export interface SessionDb {
  raw: DatabaseSync;
}

// Cache the availability check so we don't re-attempt the import on every
// call once we've learned node:sqlite is missing.
let _sqliteUnavailable = false;

type SqliteModule = typeof import("node:sqlite");

async function loadSqlite(): Promise<SqliteModule | null> {
  if (_sqliteUnavailable) return null;
  try {
    // Dynamic so the static module graph (and `next build`) never forces
    // node:sqlite to resolve.
    return (await import("node:sqlite")) as SqliteModule;
  } catch {
    _sqliteUnavailable = true;
    return null;
  }
}

/**
 * Lazily open the DB. Idempotent — repeated calls return the same handle.
 * Returns `null` when node:sqlite isn't available (Node < 22.5 / build
 * time); callers treat that as "session search disabled" and no-op.
 */
export async function getDb(): Promise<SessionDb | null> {
  if (_db && _initialized) return { raw: _db };
  const sqlite = await loadSqlite();
  if (!sqlite) return null;
  const home = reflexHome();
  await fs.mkdir(home, { recursive: true });
  const file = path.join(home, "sessions.db");
  // Stays open until the process exits — DatabaseSync has no .close
  // requirement on tear-down and Node will release the file handle.
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA temp_store = MEMORY");

  ensureSchema(db);

  _db = db;
  _initialized = true;
  return { raw: db };
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY,
      source      TEXT    NOT NULL,
      root_id     TEXT    NOT NULL,
      root_path   TEXT    NOT NULL,
      ref         TEXT    NOT NULL,
      file_path   TEXT    NOT NULL UNIQUE,
      title       TEXT,
      iso_date    TEXT,
      mtime_ms    INTEGER NOT NULL,
      indexed_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_root ON documents(root_id);
    CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
    CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(iso_date);

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title,
      body,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  const ver = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!ver) {
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
    ).run(String(SCHEMA_VERSION));
  } else if (ver.value !== String(SCHEMA_VERSION)) {
    // Future migrations branch here. For now refusal is loud.
    throw new Error(
      `sessions.db schema_version mismatch (expected ${SCHEMA_VERSION}, found ${ver.value})`,
    );
  }
}

// Exposed only for tests.
export function _resetForTest(): void {
  _db = null;
  _initialized = false;
}
