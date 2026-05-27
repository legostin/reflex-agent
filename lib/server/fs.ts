import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DirEntry {
  name: string;
  absPath: string;
  isDir: boolean;
  hidden: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}

const SYSTEM_PRUNE = new Set([
  ".Trash",
  "Library", // macOS user Library — noisy
  ".cache",
]);

export async function listDirectory(input?: string): Promise<DirListing> {
  const target = path.resolve(input?.length ? input : os.homedir());
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${target}`);
  }
  const raw = await fs.readdir(target, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const e of raw) {
    if (SYSTEM_PRUNE.has(e.name)) continue;
    const abs = path.join(target, e.name);
    const isDir =
      e.isDirectory() ||
      (e.isSymbolicLink() && (await isLinkedDir(abs)));
    entries.push({
      name: e.name,
      absPath: abs,
      isDir,
      hidden: e.name.startsWith("."),
    });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    entries,
  };
}

async function isLinkedDir(abs: string): Promise<boolean> {
  try {
    const s = await fs.stat(abs);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export function homeDir(): string {
  return os.homedir();
}
