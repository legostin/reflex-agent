import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexRoot } from "@/lib/reflex/paths";
import type { AgentEvent } from "./types";

/**
 * Append-only event log per topic. One JSON object per line. Re-read in full
 * for initial UI state; appended-to as new events arrive.
 */

const TOPICS_DIR = "topics";

export function eventsLogPath(rootPath: string, topicId: string): string {
  return path.join(reflexRoot(rootPath), TOPICS_DIR, `${topicId}.events.jsonl`);
}

export async function appendEvent(
  rootPath: string,
  topicId: string,
  event: AgentEvent,
): Promise<void> {
  const file = eventsLogPath(rootPath, topicId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
}

export async function readEvents(
  rootPath: string,
  topicId: string,
): Promise<AgentEvent[]> {
  const file = eventsLogPath(rootPath, topicId);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err: unknown) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const out: AgentEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AgentEvent);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/** Compute the next sequence number for this topic by counting prior events. */
export async function nextSeq(
  rootPath: string,
  topicId: string,
): Promise<number> {
  const events = await readEvents(rootPath, topicId);
  return events.length === 0 ? 0 : (events[events.length - 1]!.seq + 1);
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
