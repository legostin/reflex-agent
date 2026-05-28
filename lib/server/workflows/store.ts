import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexRoot } from "@/lib/reflex/paths";
import { sanitizeIdDash } from "@/lib/reflex/ids";
import type { WorkflowDef, WorkflowRun } from "./types";

const WORKFLOWS_DIR = "workflows";
const RUNS_DIR = "runs";
const MAX_RUNS_PER_WF = 50;

function workflowsDir(rootPath: string): string {
  return path.join(reflexRoot(rootPath), WORKFLOWS_DIR);
}

function workflowFile(rootPath: string, id: string): string {
  return path.join(workflowsDir(rootPath), `${sanitizeId(id)}.json`);
}

function runsDir(rootPath: string, wfId: string): string {
  return path.join(workflowsDir(rootPath), RUNS_DIR, sanitizeId(wfId));
}

function runFile(rootPath: string, wfId: string, runId: string): string {
  return path.join(runsDir(rootPath, wfId), `${sanitizeId(runId)}.json`);
}

export function sanitizeId(id: string): string {
  return sanitizeIdDash(id);
}

export async function listWorkflows(rootPath: string): Promise<WorkflowDef[]> {
  const dir = workflowsDir(rootPath);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WorkflowDef[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, e.name), "utf8");
      const parsed = JSON.parse(raw) as WorkflowDef;
      if (validate(parsed)) out.push(parsed);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export async function readWorkflow(
  rootPath: string,
  id: string,
): Promise<WorkflowDef | null> {
  try {
    const raw = await fs.readFile(workflowFile(rootPath, id), "utf8");
    const parsed = JSON.parse(raw) as WorkflowDef;
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeWorkflow(
  rootPath: string,
  wf: WorkflowDef,
): Promise<void> {
  if (!validate(wf as unknown)) {
    throw new Error(`Invalid workflow (id=${wf.id})`);
  }
  await fs.mkdir(workflowsDir(rootPath), { recursive: true });
  await fs.writeFile(
    workflowFile(rootPath, wf.id),
    JSON.stringify(wf, null, 2) + "\n",
    "utf8",
  );
}

export async function deleteWorkflow(
  rootPath: string,
  id: string,
): Promise<boolean> {
  try {
    await fs.unlink(workflowFile(rootPath, id));
    // Best-effort cleanup of run logs.
    try {
      await fs.rm(runsDir(rootPath, id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

export async function writeRun(
  rootPath: string,
  run: WorkflowRun,
): Promise<void> {
  await fs.mkdir(runsDir(rootPath, run.workflowId), { recursive: true });
  await fs.writeFile(
    runFile(rootPath, run.workflowId, run.id),
    JSON.stringify(run, null, 2) + "\n",
    "utf8",
  );
}

/**
 * List recent runs of a workflow, newest first. Cheap-ish: reads run
 * filenames and stats; only parses the top N.
 */
export async function listRuns(
  rootPath: string,
  wfId: string,
  limit = 20,
): Promise<WorkflowRun[]> {
  const dir = runsDir(rootPath, wfId);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const stats = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map(async (e) => {
        const abs = path.join(dir, e.name);
        try {
          const s = await fs.stat(abs);
          return { abs, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const sorted = stats
    .filter((x): x is { abs: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  const runs: WorkflowRun[] = [];
  for (const s of sorted) {
    try {
      const raw = await fs.readFile(s.abs, "utf8");
      runs.push(JSON.parse(raw) as WorkflowRun);
    } catch {
      /* skip malformed */
    }
  }
  return runs;
}

/**
 * Trim a workflow's run history to the most recent MAX_RUNS_PER_WF entries.
 * Called after every successful run write so the runs folder doesn't grow
 * unbounded.
 */
export async function pruneRuns(rootPath: string, wfId: string): Promise<void> {
  const dir = runsDir(rootPath, wfId);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const stats = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map(async (e) => {
        const abs = path.join(dir, e.name);
        try {
          const s = await fs.stat(abs);
          return { abs, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const sorted = stats
    .filter((x): x is { abs: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of sorted.slice(MAX_RUNS_PER_WF)) {
    await fs.unlink(old.abs).catch(() => undefined);
  }
}

function validate(wf: unknown): wf is WorkflowDef {
  if (!wf || typeof wf !== "object") return false;
  const w = wf as Record<string, unknown>;
  if (typeof w.id !== "string" || !w.id) return false;
  if (typeof w.label !== "string") return false;
  if (!Array.isArray(w.steps)) return false;
  if (typeof w.createdAt !== "string") return false;
  if (typeof w.updatedAt !== "string") return false;
  return true;
}
