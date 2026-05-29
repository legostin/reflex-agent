import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ingestFile, type StoredFile } from "@/lib/server/assets/file-store";

/**
 * The "outbox": a per-root drop zone the agent writes deliverables into
 * (`<root>/.reflex/outbox/`). At every turn-end the manager DRAINS it —
 * ingests each file into the content-addressed file store, emits an
 * `artifact` event so the user gets the audio/video/file, and removes the
 * source. This is how the agent RETURNS a produced artifact without any
 * protocol marker, so it works even on harnesses (Codex) that won't emit
 * `<<reflex:…>>`.
 *
 * `<root>/.reflex/tmp/` is a scratch dir for throwaway scripts the agent
 * writes+runs while solving a task — never surfaced, swept lazily.
 */

export function outboxDir(rootPath: string): string {
  return path.join(rootPath, ".reflex", "outbox");
}

export function scriptsDir(rootPath: string): string {
  return path.join(rootPath, ".reflex", "tmp");
}

/** Ensure the work dirs exist before the agent runs (both live in the
 *  agent's writable `.reflex` scope, so it can write into them directly). */
export async function ensureWorkDirs(rootPath: string): Promise<void> {
  await fs.mkdir(outboxDir(rootPath), { recursive: true }).catch(() => {});
  await fs.mkdir(scriptsDir(rootPath), { recursive: true }).catch(() => {});
}

/**
 * Ingest + remove every file currently in the outbox. Returns the stored
 * artifacts in name order. Best-effort per file — a bad file is left in place
 * and never crashes the turn.
 */
export async function drainOutbox(
  rootId: string,
  rootPath: string,
): Promise<StoredFile[]> {
  const dir = outboxDir(rootPath);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // no outbox yet
  }
  const out: StoredFile[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue; // skip dotfiles / .gitkeep
    const abs = path.join(dir, name);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      const stored = await ingestFile(rootId, abs, name);
      out.push(stored);
      await fs.unlink(abs).catch(() => {});
    } catch {
      // leave problematic files; don't break the turn
    }
  }
  return out;
}
