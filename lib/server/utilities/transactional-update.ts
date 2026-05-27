import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { utilityDir } from "./store";
import { getRoot } from "@/lib/registry";
import type { UtilityScope } from "./types";

/**
 * Snapshot-and-restore wrapper for updates. Renames the existing
 * utility dir to a sibling `.bak.<ts>` BEFORE the apply work runs; on
 * exception, the .bak is renamed back and the (now-broken) work dir is
 * deleted, leaving the previous version intact. On success the .bak is
 * pruned.
 *
 * Data preservation: the `data/` subfolder lives inside the utility
 * dir, so it travels with the backup. After successful apply we copy
 * `data/` from .bak into the freshly-installed dir before deleting the
 * backup — that way utility-local state (course progress, sandboxed
 * JSON, settings) survives an update even if the new manifest has a
 * different file layout.
 *
 * Used by `applyUtilityUpdateAction` so a failed esbuild during an
 * update doesn't leave the user with a half-installed broken utility.
 */
export async function withUpdateSnapshot<T>(
  scope: UtilityScope,
  id: string,
  rootId: string | undefined,
  apply: () => Promise<T>,
): Promise<T> {
  let rootPath: string | undefined;
  if (scope === "project") {
    if (!rootId) throw new Error("project-scoped update requires rootId");
    const root = await getRoot(rootId);
    if (!root) throw new Error(`unknown rootId: ${rootId}`);
    rootPath = root.path;
  }
  const dir = utilityDir(scope, id, rootPath);
  const exists = await pathExists(dir);
  if (!exists) {
    // Nothing to snapshot — first install, just run apply.
    return apply();
  }
  const backupDir = `${dir}.bak.${Date.now().toString(36)}`;
  await fs.rename(dir, backupDir);

  let succeeded = false;
  try {
    const result = await apply();
    // Carry data/ forward from the backup into the new install.
    const oldData = path.join(backupDir, "data");
    const newData = path.join(dir, "data");
    if (await pathExists(oldData)) {
      await fs.mkdir(newData, { recursive: true });
      await copyDir(oldData, newData);
    }
    succeeded = true;
    return result;
  } finally {
    if (succeeded) {
      // Discard backup — keep the disk tidy.
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    } else {
      // Failure: restore the previous version.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      await fs.rename(backupDir, dir).catch(() => {});
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}
