import "server-only";
import { getRoot } from "@/lib/registry";
import { readEvents } from "@/lib/server/agents/events-log";
import { listPendingForTopic } from "@/lib/server/agents/pending-interactions";
import { getTask } from "./store";

/**
 * Snapshot a task for the utility's polling card. Cheap: it's reading
 * one events.jsonl + scanning recent pending interactions. The utility
 * is expected to poll at ~3s while the user is looking at the board.
 *
 * Returns `null` if the task is unknown.
 */

export interface TaskObservation {
  taskId: string;
  status: string;
  topicId: string | null;
  /** Last assistant text the bound topic emitted, truncated to ~240 chars. */
  lastAssistantText: string | null;
  /** Open permission / question / mcp-add cards inside the topic. */
  pending: Array<{ kind: string; summary: string; requestId: string }>;
  /** Quick activity sparkline — last N events as kind labels. */
  recentEvents: Array<{ ts: string; kind: string }>;
  /** Set when the bound topic ended (success / cancelled / failed). */
  topicEnded: boolean;
}

const SPARK_WINDOW = 20;
const TEXT_TRUNC = 240;

export async function observeTask(args: {
  rootId: string;
  taskId: string;
}): Promise<TaskObservation | null> {
  const entry = await getRoot(args.rootId);
  if (!entry) return null;
  const task = await getTask(entry.path, args.taskId);
  if (!task) return null;

  if (!task.topicId) {
    return {
      taskId: task.id,
      status: task.status,
      topicId: null,
      lastAssistantText: null,
      pending: [],
      recentEvents: [],
      topicEnded: false,
    };
  }

  const events = await readEvents(entry.path, task.topicId).catch(() => []);
  const pendingRaw = await listPendingForTopic(entry.path, task.topicId).catch(
    () => [],
  );

  const lastAssistantText = lastAssistantTextFrom(events);
  const recentEvents = events
    .slice(-SPARK_WINDOW)
    .map((e) => ({ ts: e.ts, kind: e.type as string }));
  const topicEnded = events.some(
    (e) => e.type === "turn-end" || e.type === "agent-end",
  );

  return {
    taskId: task.id,
    status: task.status,
    topicId: task.topicId,
    lastAssistantText,
    pending: pendingRaw.map((p) => ({
      kind: p.kind,
      summary: p.summary,
      requestId: p.requestId,
    })),
    recentEvents,
    topicEnded,
  };
}

function lastAssistantTextFrom(
  events: Array<{ type: string; text?: string }>,
): string | null {
  // Walk backwards through deltas, concatenate until we hit a non-delta
  // boundary, then return the last assistant turn's text trimmed.
  let buf = "";
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "assistant-delta" && typeof ev.text === "string") {
      buf = ev.text + buf;
    } else if (ev.type === "turn-start" || ev.type === "agent-start") {
      // boundary — buf is the current/last assistant message
      break;
    }
  }
  if (!buf.trim()) return null;
  const clean = buf.replace(/<<reflex:[^>]+>>[\s\S]*?<<\/reflex:[^>]+>>/g, "").trim();
  if (!clean) return null;
  return clean.length > TEXT_TRUNC ? clean.slice(0, TEXT_TRUNC) + "…" : clean;
}
