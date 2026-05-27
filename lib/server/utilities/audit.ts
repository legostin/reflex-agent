import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { AuditEntry, AuditFilter } from "./types";

const AUDIT_DIR = path.join(os.homedir(), ".reflex", "audit");

function fileFor(date: string): string {
  return path.join(AUDIT_DIR, `${date}.jsonl`);
}

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function newCorrelationId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function appendAudit(
  entry: Omit<AuditEntry, "ts"> & { ts?: string },
): Promise<void> {
  const stamped: AuditEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    ...entry,
  } as AuditEntry;
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const file = fileFor(todayKey());
  await fs.appendFile(file, JSON.stringify(stamped) + "\n", "utf8");
}

export interface ReadAuditOptions {
  /** ISO YYYY-MM-DD. Defaults to today. */
  date?: string;
  filter?: AuditFilter;
  /** Hard cap on number of entries returned (newest first). */
  limit?: number;
}

export interface AuditReadResult {
  date: string;
  entries: AuditEntry[];
  availableDates: string[];
}

export async function readAudit(
  options: ReadAuditOptions = {},
): Promise<AuditReadResult> {
  const availableDates = await listAvailableDates();
  const date = options.date ?? availableDates[0] ?? todayKey();
  const limit = options.limit ?? 500;
  const file = fileFor(date);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { date, entries: [], availableDates };
  }
  const filtered: AuditEntry[] = [];
  const lines = raw.split(/\r?\n/);
  // Walk newest-first by reversing the parsed array; cap at limit.
  for (let i = lines.length - 1; i >= 0 && filtered.length < limit; i--) {
    const line = lines[i];
    if (!line) continue;
    let parsed: AuditEntry;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!matchesFilter(parsed, options.filter)) continue;
    filtered.push(parsed);
  }
  return { date, entries: filtered, availableDates };
}

async function listAvailableDates(): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(AUDIT_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .map((n) => n.replace(/\.jsonl$/, ""))
    .sort()
    .reverse();
}

function matchesFilter(
  entry: AuditEntry,
  filter: AuditFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.utilityId && entry.utilityId !== filter.utilityId) return false;
  if (filter.method && entry.method !== filter.method) return false;
  if (filter.phase && entry.phase !== filter.phase) return false;
  if (filter.status) {
    const ok = !entry.error;
    if (filter.status === "ok" && !ok) return false;
    if (filter.status === "error" && ok) return false;
  }
  return true;
}

/**
 * Convenience helper for the host-api layer: emits a paired start/end audit
 * trace around an awaitable, with consistent correlationId and timing.
 */
export async function auditCall<T>(
  meta: {
    utilityId: string;
    scope: AuditEntry["scope"];
    channel: AuditEntry["channel"];
    method: string;
    args?: unknown;
    parentCorrelationId?: string;
  },
  fn: (correlationId: string) => Promise<T>,
): Promise<T> {
  const correlationId = newCorrelationId();
  const t0 = Date.now();
  await appendAudit({
    ts: new Date().toISOString(),
    utilityId: meta.utilityId,
    scope: meta.scope,
    channel: meta.channel,
    method: meta.method,
    phase: "start",
    correlationId,
    ...(meta.parentCorrelationId
      ? { parentCorrelationId: meta.parentCorrelationId }
      : {}),
    args: snapshotForLog(meta.args),
  });
  try {
    const result = await fn(correlationId);
    await appendAudit({
      ts: new Date().toISOString(),
      utilityId: meta.utilityId,
      scope: meta.scope,
      channel: meta.channel,
      method: meta.method,
      phase: "end",
      correlationId,
      durationMs: Date.now() - t0,
      result: snapshotForLog(result),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit({
      ts: new Date().toISOString(),
      utilityId: meta.utilityId,
      scope: meta.scope,
      channel: meta.channel,
      method: meta.method,
      phase: "end",
      correlationId,
      durationMs: Date.now() - t0,
      error: message,
    });
    throw err;
  }
}

/** Trim payload to a reasonable size for logging — strip giant strings. */
function snapshotForLog(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") {
    return v.length > 2_000 ? v.slice(0, 2_000) + "…[truncated]" : v;
  }
  if (typeof v !== "object") return v;
  if (depth > 3) return "[…]";
  if (Array.isArray(v)) {
    return v.slice(0, 50).map((x) => snapshotForLog(x, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let i = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (i++ >= 50) {
      out["…"] = "truncated";
      break;
    }
    out[k] = snapshotForLog(val, depth + 1);
  }
  return out;
}
