import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { reflexHome } from "@/lib/reflex/home";
import type { Share, ShareFile, ShareKind } from "./types";

/**
 * Disk-backed share registry. Lives at `<REFLEX_HOME>/shares.json` (mode
 * 0600) so an OS-level user owns the secrets. The file is small —
 * shares are personal links, expect tens not thousands.
 */
const SHARES_FILE = path.join(reflexHome(), "shares.json");

async function readFile(): Promise<ShareFile> {
  try {
    const raw = await fs.readFile(SHARES_FILE, "utf8");
    const parsed = JSON.parse(raw) as ShareFile;
    if (parsed && Array.isArray(parsed.shares)) return parsed;
  } catch {
    /* fall through */
  }
  return { version: 1, shares: [] };
}

async function writeFile(file: ShareFile): Promise<void> {
  await fs.mkdir(path.dirname(SHARES_FILE), { recursive: true });
  await fs.writeFile(SHARES_FILE, JSON.stringify(file, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function listShares(): Promise<Share[]> {
  const f = await readFile();
  return f.shares;
}

export async function getShare(id: string): Promise<Share | null> {
  const f = await readFile();
  return f.shares.find((s) => s.id === id) ?? null;
}

function newShareId(): string {
  // 12 chars from a base32-ish alphabet → ~60 bits. URL-safe and short.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(salt + ":" + password)
    .digest("hex");
  return { salt, hash };
}

export function verifyPassword(share: Share, password: string): boolean {
  if (!share.passwordHash) return true;
  if (!share.passwordSalt) return false;
  const hash = crypto
    .createHash("sha256")
    .update(share.passwordSalt + ":" + password)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(share.passwordHash, "hex"),
  );
}

export async function createShare(input: {
  kind: ShareKind;
  rootId?: string;
  utilityScope?: "global" | "project";
  utilityId?: string;
  kbRelPath?: string;
  password?: string;
  expiresAt?: string;
  label?: string;
}): Promise<Share> {
  const file = await readFile();
  const id = newShareId();
  const share: Share = {
    id,
    kind: input.kind,
    createdAt: new Date().toISOString(),
    ...(input.rootId ? { rootId: input.rootId } : {}),
    ...(input.utilityScope ? { utilityScope: input.utilityScope } : {}),
    ...(input.utilityId ? { utilityId: input.utilityId } : {}),
    ...(input.kbRelPath ? { kbRelPath: input.kbRelPath } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.label ? { label: input.label } : {}),
  };
  if (input.password) {
    const { salt, hash } = hashPassword(input.password);
    share.passwordSalt = salt;
    share.passwordHash = hash;
  }
  file.shares = [share, ...file.shares];
  await writeFile(file);
  return share;
}

export async function deleteShare(id: string): Promise<boolean> {
  const file = await readFile();
  const before = file.shares.length;
  file.shares = file.shares.filter((s) => s.id !== id);
  if (file.shares.length === before) return false;
  await writeFile(file);
  return true;
}

export async function touchShare(id: string): Promise<void> {
  const file = await readFile();
  const idx = file.shares.findIndex((s) => s.id === id);
  if (idx < 0) return;
  file.shares[idx]!.lastAccessedAt = new Date().toISOString();
  await writeFile(file);
}

export function shareExpired(share: Share): boolean {
  if (!share.expiresAt) return false;
  return new Date(share.expiresAt).getTime() < Date.now();
}
