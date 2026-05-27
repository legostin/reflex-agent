"use server";

import {
  searchSessions,
  indexAllSessions,
  getIndexStats,
  type SessionSearchHit,
  type SessionSearchOptions,
  type IndexResult,
  type IndexStats,
} from "./index";

/**
 * Server actions for the session search index. UI components call these
 * directly via React's `'use server'` boundary; the host-api wrapper for
 * utilities goes through `reflex.sessions.search` (in host-api.ts).
 */

export async function searchSessionsAction(
  query: string,
  opts?: SessionSearchOptions,
): Promise<SessionSearchHit[]> {
  return searchSessions(query, opts ?? {});
}

export async function reindexSessionsAction(): Promise<IndexResult> {
  return indexAllSessions();
}

export async function getSessionsIndexStatsAction(): Promise<IndexStats> {
  return getIndexStats();
}
