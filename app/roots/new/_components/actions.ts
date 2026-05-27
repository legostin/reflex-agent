"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { getTranslations } from "next-intl/server";
import { listDirectory, type DirListing } from "@/lib/server/fs";

export type BrowseResult =
  | ({ ok: true } & DirListing)
  | { ok: false; error: string };

export async function browseAction(path: string): Promise<BrowseResult> {
  try {
    const listing = await listDirectory(path);
    return { ok: true, ...listing };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CreateDirectoryResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Create a new directory under `parent`. The name is validated to be a
 * single path segment so callers can't escape into a sibling or absolute
 * location.
 */
export async function createDirectoryAction(
  parent: string,
  name: string,
): Promise<CreateDirectoryResult> {
  const t = await getTranslations("roots");
  try {
    if (!parent || !name) {
      return { ok: false, error: t("picker.missingParentOrName") };
    }
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: t("picker.emptyName") };
    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes("\0")
    ) {
      return { ok: false, error: t("picker.invalidFolderName") };
    }
    const absParent = path.resolve(parent);
    const parentStat = await fs.stat(absParent).catch(() => null);
    if (!parentStat || !parentStat.isDirectory()) {
      return { ok: false, error: t("picker.parentNotDirectory") };
    }
    const target = path.join(absParent, trimmed);
    const rel = path.relative(absParent, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { ok: false, error: t("picker.invalidPath") };
    }
    try {
      await fs.mkdir(target, { recursive: false });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "EEXIST"
      ) {
        return {
          ok: false,
          error: t("picker.folderExists"),
        };
      }
      throw err;
    }
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
