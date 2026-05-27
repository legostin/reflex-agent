import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { reflexHome } from "@/lib/reflex/home";

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

/** Lazily open the DB. Idempotent — repeated calls return the same handle. */
export async function getDb(): Promise<SessionDb> {
  if (_db && _initialized) return { raw: _db };
  const home = reflexHome();
  await fs.mkdir(home, { recursive: true });
  const file = path.join(home, "sessions.db");
  // Stays open until the process exits — DatabaseSync has no .close
  // requirement on tear-down and Node will release the file handle.
  const db = new DatabaseSync(file);
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
