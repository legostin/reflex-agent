"use server";

import path from "node:path";
import { getRoot } from "@/lib/registry";
import { listKbFiles, type KbFileMeta } from "./kb";
import { listTopics } from "./topics";

/**
 * Server actions used by the persistent app sidebar to lazy-load a project's
 * KB tree and topic list on expand. Keep these snappy — they run on every
 * expand click.
 */

export interface SidebarSection {
  /** Path relative to .reflex/ (POSIX). */
  rel: string;
  /** Human-readable label (file title from frontmatter or filename). */
  label: string;
  /** True if this is a directory grouping; otherwise it's a file leaf. */
  isDir: boolean;
  /** For files only: full rel path to use when opening. */
  fileRel?: string;
  /** Direct children for a directory; max 2 levels deep here. */
  children?: SidebarSection[];
}

export type SidebarKbResult =
  | { ok: true; sections: SidebarSection[] }
  | { ok: false; error: string };

export async function loadKbSectionsAction(
  rootId: string,
): Promise<SidebarKbResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const files = await listKbFiles(entry.path);
    return { ok: true, sections: buildSidebarTree(files) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface SidebarTopic {
  id: string;
  title: string;
  updatedAt: string;
}

export type SidebarTopicsResult =
  | { ok: true; topics: SidebarTopic[] }
  | { ok: false; error: string };

export async function loadTopicsAction(
  rootId: string,
): Promise<SidebarTopicsResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const topics = await listTopics(entry.path);
    return {
      ok: true,
      topics: topics.map((t) => ({
        id: t.meta.id,
        title: t.meta.title,
        updatedAt: t.meta.updatedAt,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface KbInput {
  rel: string;
  meta: KbFileMeta;
}

function buildSidebarTree(files: KbInput[]): SidebarSection[] {
  // Root-level INDEX.md, then top-level directories. Inside each top-level
  // dir we surface its INDEX.md first and direct children (one level deep);
  // deeper nesting collapses to the directory page.
  const rootFiles: SidebarSection[] = [];
  const dirs = new Map<string, KbInput[]>();
  for (const f of files) {
    const parts = f.rel.split("/");
    if (parts.length === 1) {
      rootFiles.push(toLeaf(f));
      continue;
    }
    const dir = parts[0]!;
    const list = dirs.get(dir) ?? [];
    list.push(f);
    dirs.set(dir, list);
  }
  const out: SidebarSection[] = [];
  // Root-level files first, INDEX.md pinned.
  rootFiles.sort(byFilenameWithIndexFirst);
  out.push(...rootFiles);
  // Then directories alphabetical.
  const dirNames = [...dirs.keys()].sort();
  for (const dir of dirNames) {
    const items = dirs.get(dir) ?? [];
    const children = items
      .map((f) => {
        const parts = f.rel.split("/");
        // Only show one nesting level inside the sidebar; deeper nesting
        // shows as the deepest leaf's filename.
        const tail = parts.slice(1).join("/");
        return {
          rel: f.rel,
          label: f.meta.title ?? path.basename(tail),
          isDir: false,
          fileRel: f.rel,
        } satisfies SidebarSection;
      })
      .sort((a, b) =>
        path.basename(a.rel) === "INDEX.md"
          ? -1
          : path.basename(b.rel) === "INDEX.md"
            ? 1
            : a.label.localeCompare(b.label),
      );
    // Use the dir's INDEX.md title (if present) as the section label.
    const idx = children.find((c) => path.basename(c.rel) === "INDEX.md");
    const label = idx?.label ?? dir;
    out.push({
      rel: `${dir}/`,
      label,
      isDir: true,
      children,
    });
  }
  return out;
}

function toLeaf(f: KbInput): SidebarSection {
  return {
    rel: f.rel,
    label: f.meta.title ?? f.rel,
    isDir: false,
    fileRel: f.rel,
  };
}

function byFilenameWithIndexFirst(
  a: SidebarSection,
  b: SidebarSection,
): number {
  const aBase = path.basename(a.rel);
  const bBase = path.basename(b.rel);
  if (aBase === "INDEX.md") return -1;
  if (bBase === "INDEX.md") return 1;
  return a.label.localeCompare(b.label);
}
