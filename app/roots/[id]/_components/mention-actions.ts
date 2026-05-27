"use server";

import path from "node:path";
import { getRoot } from "@/lib/registry";
import { reflexRoot, REFLEX_DIR } from "@/lib/reflex/paths";
import { walk } from "@/lib/reflex/walker";

export interface MentionItem {
  kind: "kb" | "file" | "utility";
  /** Path relative to project root (POSIX), used in @-mention text.
   *  For utilities this is the synthetic `util:<scope>/<id>` token —
   *  agents recognise the prefix in transcripts and can navigate. */
  relPath: string;
  /** Absolute path on disk (empty for utilities). */
  absPath: string;
  /** Display label (utility name + scope, or basename + parent hint). */
  label: string;
  /** Parent dir for grouping in the picker. */
  parent: string;
}

export type MentionSearchResult =
  | { ok: true; items: MentionItem[] }
  | { ok: false; error: string };

const MAX_ITEMS = 30;

/**
 * Resolve `@<query>` autocomplete for the chat input. Walks both the project
 * source (respecting `.reflexignore`) and the materialized KB under
 * `.reflex/`. KB notes are surfaced first since the user usually wants those.
 */
export async function searchMentionsAction(
  rootId: string,
  query: string,
): Promise<MentionSearchResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const q = (query ?? "").toLowerCase().trim();

    const items: MentionItem[] = [];

    // Installed utilities first — usually the user knows what they're
    // looking for by name and wants a one-tap insert into the message.
    try {
      const { listUtilities } = await import("@/lib/server/utilities/store");
      const utils = await listUtilities({ rootId });
      for (const u of utils) {
        items.push({
          kind: "utility",
          relPath: `util:${u.scope}/${u.manifest.id}`,
          absPath: "",
          label: `${u.manifest.name} (${u.scope})`,
          parent: "utilities",
        });
      }
    } catch {
      /* listUtilities failure shouldn't block KB/file mentions */
    }

    // KB notes next.
    for await (const e of walk(reflexRoot(entry.path))) {
      if (e.isDir) continue;
      if (!e.rel.toLowerCase().endsWith(".md")) continue;
      // Skip topic transcripts and attachments dirs.
      if (e.rel.startsWith("topics/")) continue;
      if (e.rel.startsWith("attachments/")) continue;
      const rel = `${REFLEX_DIR}/${e.rel}`;
      items.push({
        kind: "kb",
        relPath: rel,
        absPath: e.abs,
        label: e.rel,
        parent: path.dirname(e.rel) === "." ? REFLEX_DIR : `${REFLEX_DIR}/${path.dirname(e.rel)}`,
      });
    }

    // Project source files (walker already honors .reflexignore + DEFAULT_PRUNE
    // so .reflex/ and node_modules are excluded).
    for await (const e of walk(entry.path)) {
      if (e.isDir) continue;
      items.push({
        kind: "file",
        relPath: e.rel,
        absPath: e.abs,
        label: e.rel,
        parent: path.dirname(e.rel) === "." ? "" : path.dirname(e.rel),
      });
    }

    const filtered = q
      ? items.filter((i) => {
          const lower = i.relPath.toLowerCase();
          const base = path.basename(i.relPath).toLowerCase();
          return base.includes(q) || lower.includes(q);
        })
      : items;

    const order: Record<MentionItem["kind"], number> = {
      utility: 0,
      kb: 1,
      file: 2,
    };
    filtered.sort((a, b) => {
      if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
      // Files matching basename start-with score better
      if (q) {
        const aBase = path.basename(a.label).toLowerCase();
        const bBase = path.basename(b.label).toLowerCase();
        const as = aBase.startsWith(q) ? 0 : 1;
        const bs = bBase.startsWith(q) ? 0 : 1;
        if (as !== bs) return as - bs;
      }
      return a.relPath.localeCompare(b.relPath);
    });

    return { ok: true, items: filtered.slice(0, MAX_ITEMS) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
