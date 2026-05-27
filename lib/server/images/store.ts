import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getRoot } from "@/lib/registry";

/**
 * Per-root image storage. Files live at
 *   <rootDirectory>/.reflex/assets/images/<sha256>.<ext>
 * and are served via `/api/images/<rootId>/<sha>.<ext>`. SHA-based naming
 * gives us free dedupe-in-root and lets us hand out `Cache-Control: immutable`
 * URLs.
 */

const SUBPATH = path.join(".reflex", "assets", "images");

export interface StoredImage {
  /** sha256 hex (full 64 chars). */
  sha: string;
  /** Extension WITHOUT leading dot. */
  ext: string;
  /** Mime type. */
  mime: string;
  /** Absolute path on disk. */
  absPath: string;
  /** Path under the root, slash-normalized. */
  relPath: string;
  /** App URL — what to put inside `![](...)`. */
  urlPath: string;
  size: number;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
};

function extForMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? "bin";
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

async function rootPath(rootId: string): Promise<string> {
  const entry = await getRoot(rootId);
  if (!entry) throw new Error(`unknown root: ${rootId}`);
  return entry.path;
}

async function storeDir(rootId: string): Promise<string> {
  const dir = path.join(await rootPath(rootId), SUBPATH);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function saveImageBytes(
  rootId: string,
  bytes: Buffer | Uint8Array,
  mime: string,
): Promise<StoredImage> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const ext = extForMime(mime);
  const dir = await storeDir(rootId);
  const absPath = path.join(dir, `${sha}.${ext}`);
  try {
    await fs.access(absPath);
  } catch {
    await fs.writeFile(absPath, buf);
  }
  return {
    sha,
    ext,
    mime,
    absPath,
    relPath: path.posix.join(SUBPATH.split(path.sep).join("/"), `${sha}.${ext}`),
    urlPath: `/api/images/${encodeURIComponent(rootId)}/${sha}.${ext}`,
    size: buf.byteLength,
  };
}

/** Reject anything bigger than this to avoid runaway downloads. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Stream a remote URL into per-root storage. Caller is responsible for
 * authorising the host (e.g. domain whitelist for utility-initiated calls).
 * Hard 20 MB cap; reject non-image content types.
 */
export async function downloadToStore(
  rootId: string,
  sourceUrl: string,
): Promise<StoredImage> {
  const res = await fetch(sourceUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(
      `fetch ${sourceUrl} -> ${res.status} ${res.statusText}`,
    );
  }
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!mime.startsWith("image/")) {
    throw new Error(`not an image: content-type=${mime || "(none)"}`);
  }
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `image too large: ${contentLength} bytes (cap ${MAX_DOWNLOAD_BYTES})`,
    );
  }
  const arr = await res.arrayBuffer();
  if (arr.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `image too large after download: ${arr.byteLength} bytes (cap ${MAX_DOWNLOAD_BYTES})`,
    );
  }
  return saveImageBytes(rootId, Buffer.from(arr), mime);
}

/**
 * Resolve an `<sha>.<ext>` file inside the per-root store. Returns null if
 * the request escapes the store dir or the file is missing. Used by the
 * GET route — keep it strict.
 */
export async function resolveStoredFile(
  rootId: string,
  fileName: string,
): Promise<{ absPath: string; mime: string; size: number } | null> {
  if (!/^[a-f0-9]{8,64}\.[a-z0-9]{2,5}$/i.test(fileName)) return null;
  const dir = await storeDir(rootId);
  const abs = path.resolve(dir, fileName);
  // Containment check — defence in depth against URL-decoded `..` slipping
  // through the regex.
  if (!abs.startsWith(dir + path.sep) && abs !== dir) return null;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    const ext = path.extname(fileName).slice(1);
    return { absPath: abs, mime: mimeForExt(ext), size: stat.size };
  } catch {
    return null;
  }
}
