"use server";

import matter from "gray-matter";
import { getRoot } from "@/lib/registry";
import { readKbFile, type KbFileMeta } from "@/lib/server/kb";

export type ReadKbFileResult =
  | { ok: true; content: string; meta: KbFileMeta }
  | { ok: false; error: string };

/**
 * Read a KB file's body + parse its frontmatter in one shot. The viewer
 * needs both — combining the two saves a separate metadata round-trip
 * and aligns with the new "lazy frontmatter" strategy in `kb.ts` (we
 * parse YAML only when a file is actually being looked at, not for
 * every file in the tree on page load).
 */
export async function readKbFileAction(
  rootId: string,
  rel: string,
): Promise<ReadKbFileResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const content = await readKbFile(entry.path, rel);
    const meta = extractMeta(content);
    return { ok: true, content, meta };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractMeta(content: string): KbFileMeta {
  try {
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;
    return {
      ...(typeof data.title === "string" ? { title: data.title } : {}),
      ...(typeof data.version === "string" || typeof data.version === "number"
        ? { version: data.version as string | number }
        : {}),
      ...(typeof data.date === "string" ? { date: data.date } : {}),
      ...(typeof data.kind === "string" ? { kind: data.kind } : {}),
      data,
    };
  } catch {
    return { data: {} };
  }
}
