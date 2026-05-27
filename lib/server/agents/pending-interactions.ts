import "server-only";
import { promises as fs } from "node:fs";
import { eventsLogPath, readEvents } from "./events-log";
import type { AgentEvent } from "./types";

/**
 * Per-file mtime cache for the (relatively expensive) events.jsonl scan.
 * Each dashboard load used to re-parse every closed topic's full event
 * log just to compute "is there anything pending?" — but that answer
 * only changes when the log itself is appended to. Cache on globalThis
 * so HMR doesn't blow it away mid-session.
 */
interface PendingCacheEntry {
  mtimeMs: number;
  size: number;
  result: PendingInteraction[];
}

declare global {
  // eslint-disable-next-line no-var
  var __reflexPendingCache: Map<string, PendingCacheEntry> | undefined;
}

function cache(): Map<string, PendingCacheEntry> {
  if (!globalThis.__reflexPendingCache) {
    globalThis.__reflexPendingCache = new Map();
  }
  return globalThis.__reflexPendingCache;
}

/**
 * "Interaction" = a card the agent is waiting on user reaction for:
 *   - permission-request  (paired with permission-response by requestId)
 *   - question            (paired with answer by questionId)
 *   - mcp-add-request     (paired with mcp-add-response by requestId)
 *
 * For dashboards we want to surface these across all topics of a root —
 * they're "the project is waiting on you" signals. Scan each topic's
 * events.jsonl and emit one record per still-unanswered request.
 */
export type PendingKind = "permission" | "question" | "mcp-add";

export interface PendingInteraction {
  kind: PendingKind;
  topicId: string;
  requestId: string;
  /** ISO timestamp from the originating event. */
  ts: string;
  /** Short summary surfaced as the card's title. */
  summary: string;
  /** Free-form extra context (tool name, server label, choices, …). */
  details?: string;
}

export async function listPendingForTopic(
  rootPath: string,
  topicId: string,
): Promise<PendingInteraction[]> {
  const file = eventsLogPath(rootPath, topicId);
  // Stat first — if the log hasn't been appended to since the last cached
  // result, return that. Stat is O(1); a full read+parse on a busy topic
  // can be 50-500KB plus JSON parsing per line.
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(file);
  } catch {
    // Missing file = no events = nothing pending.
    return [];
  }
  const key = file;
  const cached = cache().get(key);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.result;
  }
  const events = await readEvents(rootPath, topicId);
  const result = scan(events, topicId);
  cache().set(key, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    result,
  });
  return result;
}

export async function listPendingForRoot(
  rootPath: string,
  topicIds: string[],
): Promise<PendingInteraction[]> {
  const out: PendingInteraction[] = [];
  await Promise.all(
    topicIds.map(async (topicId) => {
      const list = await listPendingForTopic(rootPath, topicId);
      out.push(...list);
    }),
  );
  // Newest first — dashboards usually want fresh asks on top.
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out;
}

/**
 * Pure scan: events in chronological order, returns unanswered requests.
 * Pairs are tracked by id; the *last* matching response wins (in case the
 * user re-decided). If no response exists, the request is "pending".
 */
function scan(events: AgentEvent[], topicId: string): PendingInteraction[] {
  const open = new Map<string, PendingInteraction>();
  for (const ev of events) {
    switch (ev.type) {
      case "permission-request":
        open.set(`p:${ev.requestId}`, {
          kind: "permission",
          topicId,
          requestId: ev.requestId,
          ts: ev.ts,
          summary: ev.tool
            ? `Permission: ${ev.tool}`
            : (ev.action ?? "Permission request"),
          ...(ev.description ? { details: ev.description } : {}),
        });
        break;
      case "permission-response":
        open.delete(`p:${ev.requestId}`);
        break;
      case "question":
        open.set(`q:${ev.questionId}`, {
          kind: "question",
          topicId,
          requestId: ev.questionId,
          ts: ev.ts,
          summary: ev.prompt.slice(0, 200),
          ...(ev.choices && ev.choices.length
            ? { details: ev.choices.join(" / ") }
            : {}),
        });
        break;
      case "answer":
        open.delete(`q:${ev.questionId}`);
        break;
      case "mcp-add-request":
        open.set(`m:${ev.requestId}`, {
          kind: "mcp-add",
          topicId,
          requestId: ev.requestId,
          ts: ev.ts,
          summary: `MCP add: ${ev.label}`,
          ...(ev.description ? { details: ev.description } : {}),
        });
        break;
      case "mcp-add-response":
        open.delete(`m:${ev.requestId}`);
        break;
      default:
        break;
    }
  }
  return [...open.values()];
}
