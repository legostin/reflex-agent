import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { reflexHome } from "./reflex/home.js";

/**
 * Registry of Reflex-managed roots. Stored at `<REFLEX_HOME>/registry.json` so
 * it survives across web-UI sessions and is shared with the CLI if needed.
 */

const REGISTRY_DIR = reflexHome();
const REGISTRY_FILE = path.join(REGISTRY_DIR, "registry.json");

export interface RegistryEntry {
  /** Stable id derived from the absolute path. */
  id: string;
  /** Absolute path on disk. */
  path: string;
  /** ISO timestamp when this root was added. */
  addedAt: string;
  /** ISO timestamp of the last completed `init` run, if any. */
  lastInitAt?: string;
}

interface RegistryFile {
  version: 1;
  entries: RegistryEntry[];
}

const EMPTY: RegistryFile = { version: 1, entries: [] };

export function rootId(absPath: string): string {
  return crypto
    .createHash("sha1")
    .update(path.resolve(absPath))
    .digest("hex")
    .slice(0, 16);
}

async function readFile(): Promise<RegistryFile> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "entries" in parsed &&
      Array.isArray((parsed as { entries: unknown }).entries)
    ) {
      return parsed as RegistryFile;
    }
    return EMPTY;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return EMPTY;
    }
    throw err;
  }
}

async function writeFile(file: RegistryFile): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  await fs.writeFile(
    REGISTRY_FILE,
    JSON.stringify(file, null, 2) + "\n",
    "utf8",
  );
}

export async function listRoots(): Promise<RegistryEntry[]> {
  const file = await readFile();
  return [...file.entries].sort(
    (a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt),
  );
}

export async function getRoot(id: string): Promise<RegistryEntry | null> {
  const file = await readFile();
  return file.entries.find((e) => e.id === id) ?? null;
}

export async function addRoot(absPath: string): Promise<RegistryEntry> {
  const resolved = path.resolve(absPath);
  const id = rootId(resolved);
  const file = await readFile();
  const existing = file.entries.find((e) => e.id === id);
  if (existing) return existing;
  const entry: RegistryEntry = {
    id,
    path: resolved,
    addedAt: new Date().toISOString(),
  };
  await writeFile({ ...file, entries: [...file.entries, entry] });
  return entry;
}

export async function removeRoot(id: string): Promise<void> {
  const file = await readFile();
  await writeFile({
    ...file,
    entries: file.entries.filter((e) => e.id !== id),
  });
}

export async function markInitialized(id: string): Promise<void> {
  const file = await readFile();
  const idx = file.entries.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const updated = [...file.entries];
  const existing = updated[idx]!;
  updated[idx] = { ...existing, lastInitAt: new Date().toISOString() };
  await writeFile({ ...file, entries: updated });
}
