import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  deleteCodexSession,
  ensureImagegenSkillInstalled,
  generatedImagesDir,
  getCodexClient,
} from "@/lib/server/codex/client";
import { saveImageBytes, type StoredImage, mimeForExt } from "../store";

/**
 * Codex image generation through the official `@openai/codex-sdk`. The
 * SDK spawns `codex exec`; we use it because it's the sanctioned entry
 * point and ships typed streaming events instead of raw stdout parsing.
 *
 * Flow:
 *   1. Ensure our bundled `imagegen` SKILL.md is in `$CODEX_HOME` (works
 *      around openai/codex#20946).
 *   2. Snapshot `~/.codex/generated_images/` before the call.
 *   3. `thread.run("$imagegen <prompt>")` — Codex picks the prompt-
 *      engineered skill, calls the hosted `image_gen` tool, writes a
 *      PNG into the snapshot dir.
 *   4. Diff the dir; pick the new file (or the newest one if multiple);
 *      ingest into Reflex's per-root store.
 *
 * Auth comes from the user's existing `codex login`. No extra API key.
 */

export interface CodexGenInput {
  rootId: string;
  prompt: string;
  size?: string;
}

export async function generateWithCodex(
  input: CodexGenInput,
): Promise<StoredImage> {
  await ensureImagegenSkillInstalled();
  const dir = generatedImagesDir();
  const before = await snapshotDir(dir);

  const codex = getCodexClient();
  const thread = codex.startThread({
    sandboxMode: "workspace-write",
    additionalDirectories: [dir],
    approvalPolicy: "never",
    skipGitRepoCheck: true,
  });

  const userPrompt = [
    `$imagegen — generate one image.`,
    input.size ? `Size: ${input.size}.` : "",
    "After it is saved, print exactly one line:",
    `RESULT_PATH=<absolute path to the saved file>`,
    "Then stop. Do not move the file; do not generate variants.",
    "",
    `Image description: ${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  let finalResponse = "";
  try {
    const turn = await thread.run(userPrompt);
    finalResponse = turn.finalResponse ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`codex image-gen failed: ${msg.slice(0, 400)}`);
  } finally {
    // Keep image-gen's ephemeral thread out of `codex resume` history.
    await deleteCodexSession(thread.id);
  }

  // 1. Prefer an explicit RESULT_PATH line — that's the most reliable
  //    signal even if Codex also wrote unrelated chatter.
  let resolved = parseResultPath(finalResponse);
  // 2. Fall back: diff the generated_images dir to find what's new.
  if (!resolved || !(await fileExists(resolved))) {
    const after = await snapshotDir(dir);
    const fresh = pickFreshest(before, after);
    if (fresh) resolved = fresh;
  }
  if (!resolved) {
    throw new Error(
      `Codex finished but no image file was found in ${dir}. Last response: ${tailOf(finalResponse, 200)}`,
    );
  }

  const bytes = await fs.readFile(resolved);
  const ext = path.extname(resolved).slice(1).toLowerCase() || "png";
  const mime = mimeForExt(ext);
  return saveImageBytes(input.rootId, bytes, mime);
}

interface DirSnapshot {
  files: Map<string, number>; // abs path → mtimeMs
}

async function snapshotDir(dir: string): Promise<DirSnapshot> {
  const files = new Map<string, number>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory may not exist yet — first-ever image generation.
    return { files };
  }
  await Promise.all(
    entries.map(async (name) => {
      const abs = path.join(dir, name);
      try {
        const stat = await fs.stat(abs);
        if (stat.isFile()) files.set(abs, stat.mtimeMs);
      } catch {
        /* ignore */
      }
    }),
  );
  return { files };
}

function pickFreshest(
  before: DirSnapshot,
  after: DirSnapshot,
): string | null {
  let best: { path: string; mtime: number } | null = null;
  for (const [abs, mtime] of after.files) {
    const wasBefore = before.files.get(abs);
    // New file, or pre-existing file rewritten with newer mtime.
    if (wasBefore === undefined || mtime > wasBefore) {
      if (!best || mtime > best.mtime) {
        best = { path: abs, mtime };
      }
    }
  }
  return best?.path ?? null;
}

function parseResultPath(text: string): string | null {
  const m = /RESULT_PATH\s*=\s*([^\r\n]+?)\s*$/m.exec(text.trim());
  if (!m) return null;
  const raw = m[1]!.trim().replace(/^['"]|['"]$/g, "");
  return raw.length > 0 ? raw : null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function tailOf(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? "…" + t.slice(t.length - n) : t;
}
