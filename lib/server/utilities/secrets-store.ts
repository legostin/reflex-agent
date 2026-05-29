import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { reflexHome } from "@/lib/reflex/home";
import { writeJsonFile } from "@/lib/reflex/store/json-store";
import type { UtilityScope } from "./types";

/**
 * Per-utility secret storage. Lives at
 *
 *   ~/.reflex/secrets/<scope>/<bucket>/<utility-id>.json
 *
 * deliberately **outside** any agent's `--add-dir` scope (which only covers
 * `<project>/.reflex/`). Agents therefore cannot Read/Glob secret files.
 * Files are written with mode 0600.
 *
 * - `scope = "global"` → bucket = "_"
 * - `scope = "project"` → bucket = sha1(rootPath).slice(0,16), the same
 *   identifier the registry uses, so per-project utilities have isolated
 *   secret stores even if their ids collide across projects.
 *
 * Values are stored plaintext. This is a local-first dev tool — disk-level
 * encryption is the user's OS responsibility. Don't make the false promise
 * of "encrypted" with a key sitting next to the data.
 */

interface SecretsFile {
  version: 1;
  values: Record<string, string>;
}

const SECRETS_ROOT = path.join(reflexHome(), "secrets");

function bucketFor(scope: UtilityScope, rootId?: string): string {
  if (scope === "global") return "_";
  if (!rootId) throw new Error("project-scope secrets require rootId");
  // rootId is already a stable 16-hex id from the registry (sha1 of resolved
  // path). Use it directly.
  return /^[a-f0-9]{8,64}$/.test(rootId)
    ? rootId
    : createHash("sha1").update(rootId).digest("hex").slice(0, 16);
}

function secretsFile(
  scope: UtilityScope,
  id: string,
  rootId?: string,
): string {
  return path.join(SECRETS_ROOT, scope, bucketFor(scope, rootId), `${id}.json`);
}

async function readFile(p: string): Promise<SecretsFile> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<SecretsFile>;
    if (parsed.version !== 1 || !parsed.values || typeof parsed.values !== "object") {
      return { version: 1, values: {} };
    }
    return { version: 1, values: parsed.values };
  } catch {
    return { version: 1, values: {} };
  }
}

async function writeFile(p: string, data: SecretsFile): Promise<void> {
  // Owner read/write only — atomic + serialized via the shared json-store.
  await writeJsonFile(p, data, { mode: 0o600 });
}

export async function getSecret(
  scope: UtilityScope,
  id: string,
  key: string,
  rootId?: string,
): Promise<string | null> {
  const file = await readFile(secretsFile(scope, id, rootId));
  return Object.prototype.hasOwnProperty.call(file.values, key)
    ? file.values[key]!
    : null;
}

export async function setSecret(
  scope: UtilityScope,
  id: string,
  key: string,
  value: string,
  rootId?: string,
): Promise<void> {
  const p = secretsFile(scope, id, rootId);
  const file = await readFile(p);
  file.values[key] = value;
  await writeFile(p, file);
}

export async function deleteSecret(
  scope: UtilityScope,
  id: string,
  key: string,
  rootId?: string,
): Promise<void> {
  const p = secretsFile(scope, id, rootId);
  const file = await readFile(p);
  if (!(key in file.values)) return;
  delete file.values[key];
  await writeFile(p, file);
}

/**
 * Lists keys that have a value set. Never returns the values themselves —
 * this is what the UI uses to render filled / missing badges.
 */
export async function listSecretKeys(
  scope: UtilityScope,
  id: string,
  rootId?: string,
): Promise<string[]> {
  const file = await readFile(secretsFile(scope, id, rootId));
  return Object.keys(file.values).sort();
}

/**
 * Drop the entire secrets file for a utility — used when uninstalling.
 */
export async function dropSecrets(
  scope: UtilityScope,
  id: string,
  rootId?: string,
): Promise<void> {
  const p = secretsFile(scope, id, rootId);
  try {
    await fs.unlink(p);
  } catch {
    // missing → fine
  }
}
