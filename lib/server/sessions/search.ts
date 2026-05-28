import "server-only";
import { getDb } from "./db";

/**
 * Search the FTS5 index of journal entries and topic transcripts.
 *
 * The query is forwarded to SQLite's MATCH operator with a couple of
 * safety nets:
 *  - We strip FTS5 reserved chars the user is unlikely to want as
 *    operators (`"`, `*`, `^`, `:`). NEAR / OR / AND survive — they're
 *    useful when an agent composes a complex query.
 *  - Empty / whitespace-only queries short-circuit to an empty result,
 *    because FTS5 throws on those.
 *
 * Ranking is `bm25(documents_fts)` ascending (lower = better). We
 * surface the rank value on each hit so callers can decide their own
 * cutoff.
 */

export type SessionSource = "journal" | "topic";

export interface SessionSearchHit {
  id: number;
  source: SessionSource;
  rootId: string;
  rootPath: string;
  /** Filename without extension — topic id, or journal slug. */
  ref: string;
  title: string;
  /** ISO date (entry date for journals, createdAt for topics). May be null. */
  isoDate: string | null;
  /** FTS5 bm25 score — lower is more relevant. */
  rank: number;
  /** Snippet with the matched terms highlighted via {{…}}. */
  snippet: string;
}

export interface SessionSearchOptions {
  /** Restrict to a specific root id. Omit for global search. */
  rootId?: string;
  /** Restrict to journal or topic. Omit for both. */
  source?: SessionSource;
  /** Earliest iso date (inclusive). */
  since?: string;
  /** Latest iso date (inclusive). */
  until?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function searchSessions(
  query: string,
  opts: SessionSearchOptions = {},
): Promise<SessionSearchHit[]> {
  const ftsQuery = normaliseQuery(query);
  if (!ftsQuery) return [];

  const handle = await getDb();
  if (!handle) return []; // node:sqlite unavailable — search disabled
  const db = handle.raw;
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const filters: string[] = ["documents_fts MATCH ?"];
  const params: unknown[] = [ftsQuery];

  if (opts.rootId) {
    filters.push("d.root_id = ?");
    params.push(opts.rootId);
  }
  if (opts.source) {
    filters.push("d.source = ?");
    params.push(opts.source);
  }
  if (opts.since) {
    filters.push("d.iso_date >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    filters.push("d.iso_date <= ?");
    params.push(opts.until);
  }

  const sql = `
    SELECT
      d.id        AS id,
      d.source    AS source,
      d.root_id   AS root_id,
      d.root_path AS root_path,
      d.ref       AS ref,
      d.title     AS title,
      d.iso_date  AS iso_date,
      bm25(documents_fts) AS rank,
      snippet(documents_fts, 1, '{{', '}}', '…', 12) AS snippet
    FROM documents_fts
    JOIN documents d ON d.id = documents_fts.rowid
    WHERE ${filters.join(" AND ")}
    ORDER BY rank ASC
    LIMIT ?
  `;
  params.push(limit);

  let rows: Array<{
    id: number;
    source: SessionSource;
    root_id: string;
    root_path: string;
    ref: string;
    title: string;
    iso_date: string | null;
    rank: number;
    snippet: string;
  }>;
  try {
    rows = db.prepare(sql).all(...(params as never[])) as typeof rows;
  } catch (err) {
    // Malformed FTS5 expression (`NEAR(`, stray `(`, etc.) — fall back
    // to one fuzzy term so the caller still gets *something*.
    const fallback = ftsQuery.replace(/[()"^*:]/g, " ").trim();
    if (!fallback || fallback === ftsQuery) {
      throw err;
    }
    params[0] = fallback;
    rows = db.prepare(sql).all(...(params as never[])) as typeof rows;
  }

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    rootId: r.root_id,
    rootPath: r.root_path,
    ref: r.ref,
    title: r.title,
    isoDate: r.iso_date,
    rank: r.rank,
    snippet: r.snippet,
  }));
}

function normaliseQuery(q: string): string {
  if (!q) return "";
  // Strip leading/trailing FTS5 operator garbage but preserve OR/AND/NOT.
  const cleaned = q
    .replace(/[\^*:"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // If the user gave a bare phrase like `oauth refresh`, wrap each token
  // as a prefix so single-typo terms still match. We keep operator
  // tokens untouched.
  const OPS = new Set(["AND", "OR", "NOT", "NEAR"]);
  const out = cleaned
    .split(" ")
    .map((tok) => {
      if (!tok) return tok;
      if (OPS.has(tok.toUpperCase())) return tok.toUpperCase();
      // Already wrapped in quotes or contains FTS5 syntax — leave as-is.
      if (/[()]/.test(tok)) return tok;
      // Plain word — make it a prefix match.
      return `${tok}*`;
    })
    .filter(Boolean)
    .join(" ");
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface IndexStats {
  documents: number;
  journals: number;
  topics: number;
}

export async function getIndexStats(): Promise<IndexStats> {
  const handle = await getDb();
  if (!handle) return { documents: 0, journals: 0, topics: 0 };
  const db = handle.raw;
  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }
  ).n;
  const journals = (
    db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE source = 'journal'")
      .get() as { n: number }
  ).n;
  const topics = (
    db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE source = 'topic'")
      .get() as { n: number }
  ).n;
  return { documents: total, journals, topics };
}
