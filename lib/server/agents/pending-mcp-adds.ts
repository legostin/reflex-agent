import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpAddDirective } from "./protocol";

/**
 * Persisted scratch for in-flight `<<reflex:mcp-add>>` proposals so they
 * survive HMR / dev-server restarts. Without persistence, the in-memory
 * Map on AgentManager is dropped between code reloads, leaving the user's
 * card un-approvable with the unhelpful "Agent not found" error.
 *
 * Each entry stores enough context to (1) merge the user's reply into the
 * config and save the server, and (2) emit a follow-up event into the
 * topic's events.jsonl directly when the original agent is no longer alive
 * (so the card can flip to "resolved").
 */

export interface PendingEntry {
  requestId: string;
  agentId: string;
  topicId: string;
  rootPath: string;
  directive: McpAddDirective;
  createdAt: string;
}

const FILE = path.join(os.homedir(), ".reflex", "pending-mcp-adds.json");
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface File {
  version: 1;
  entries: PendingEntry[];
}

async function read(): Promise<File> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<File>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed as File;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function write(file: File): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(file, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await fs.chmod(FILE, 0o600);
  } catch {
    /* best effort */
  }
}

function prune(file: File): File {
  const cutoff = Date.now() - TTL_MS;
  return {
    version: 1,
    entries: file.entries.filter((e) => {
      const ts = Date.parse(e.createdAt);
      return Number.isFinite(ts) && ts > cutoff;
    }),
  };
}

export async function savePendingMcpAdd(entry: Omit<PendingEntry, "createdAt">): Promise<void> {
  const file = prune(await read());
  file.entries = file.entries.filter((e) => e.requestId !== entry.requestId);
  file.entries.push({ ...entry, createdAt: new Date().toISOString() });
  await write(file);
}

/**
 * Read all non-expired pending entries. Used by the project dashboard to
 * surface "MCP add waiting on you" cards across topics. Does NOT remove
 * the entries — only `takePendingMcpAdd` consumes.
 */
export async function listPendingMcpAdds(): Promise<PendingEntry[]> {
  const file = prune(await read());
  return file.entries;
}

export async function takePendingMcpAdd(
  requestId: string,
): Promise<PendingEntry | null> {
  const file = prune(await read());
  const idx = file.entries.findIndex((e) => e.requestId === requestId);
  if (idx < 0) return null;
  const entry = file.entries[idx]!;
  file.entries.splice(idx, 1);
  await write(file);
  return entry;
}
