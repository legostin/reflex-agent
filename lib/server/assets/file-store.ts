import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getRoot } from "@/lib/registry";

/**
 * Per-root storage for arbitrary deliverable files the agent produces —
 * audio, video, PDFs, archives, data dumps, etc. (Images keep their own
 * store under `assets/images`.) Files live at
 *   <rootDirectory>/.reflex/assets/files/<sha256>.<ext>
 * and are served via `/api/files/<rootId>/<sha>.<ext>`. Content-addressed,
 * so URLs are immutable and dedupe within a root.
 *
 * This backs the "outbox" delivery mechanism: the agent writes a deliverable
 * into `<root>/.reflex/outbox/`, Reflex diffs that dir at turn-end, ingests
 * the new file here, and surfaces it to the user as an audio/video/file
 * message — no protocol marker needed (works on harnesses like Codex that
 * won't emit `<<reflex:…>>`).
 */

const SUBPATH = path.join(".reflex", "assets", "files");

export type ArtifactKind = "image" | "audio" | "video" | "file";

export interface StoredFile {
  sha: string;
  ext: string;
  mime: string;
  kind: ArtifactKind;
  absPath: string;
  relPath: string;
  /** App URL to fetch the bytes. */
  urlPath: string;
  /** Suggested display/download name. */
  name: string;
  size: number;
}

// Broad ext→mime table covering the deliverables an agent realistically
// produces. Unknown extensions fall back to octet-stream (downloadable file).
const EXT_TO_MIME: Record<string, string> = {
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // images (so the file store can hold them too if routed here)
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  // docs / data
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Classify a file (by mime, falling back to ext) for how to render it. */
export function artifactKind(mime: string, ext = ""): ArtifactKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  // mime may be octet-stream for odd exts — use the extension as a hint.
  const e = ext.toLowerCase().replace(/^\./, "");
  if (["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "aiff", "aif"].includes(e))
    return "audio";
  if (["mp4", "webm", "mov", "m4v", "mkv", "avi"].includes(e)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"].includes(e)) return "image";
  return "file";
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

/** Reject anything bigger than this to avoid runaway ingest. */
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Save raw bytes into the per-root file store under the given extension. */
export async function saveFileBytes(
  rootId: string,
  bytes: Buffer | Uint8Array,
  ext: string,
  displayName: string,
): Promise<StoredFile> {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new Error(`file too large: ${buf.byteLength} bytes (cap ${MAX_FILE_BYTES})`);
  }
  const e = (ext || "bin").toLowerCase().replace(/^\./, "");
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const dir = await storeDir(rootId);
  const absPath = path.join(dir, `${sha}.${e}`);
  try {
    await fs.access(absPath);
  } catch {
    await fs.writeFile(absPath, buf);
  }
  const mime = mimeForExt(e);
  return {
    sha,
    ext: e,
    mime,
    kind: artifactKind(mime, e),
    absPath,
    relPath: path.posix.join(SUBPATH.split(path.sep).join("/"), `${sha}.${e}`),
    urlPath: `/api/files/${encodeURIComponent(rootId)}/${sha}.${e}`,
    name: displayName.trim() || `${sha.slice(0, 8)}.${e}`,
    size: buf.byteLength,
  };
}

/** Ingest a file from an absolute path into the per-root file store. */
export async function ingestFile(
  rootId: string,
  sourceAbsPath: string,
  displayName?: string,
): Promise<StoredFile> {
  const stat = await fs.stat(sourceAbsPath);
  if (!stat.isFile()) throw new Error(`not a file: ${sourceAbsPath}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`file too large: ${stat.size} bytes (cap ${MAX_FILE_BYTES})`);
  }
  const buf = await fs.readFile(sourceAbsPath);
  const ext = (path.extname(sourceAbsPath).slice(1) || "bin").toLowerCase();
  return saveFileBytes(rootId, buf, ext, displayName?.trim() || path.basename(sourceAbsPath));
}

/**
 * Resolve an `<sha>.<ext>` file inside the per-root store. Returns null if
 * the request escapes the store dir or the file is missing. Used by the GET
 * route — keep it strict.
 */
export async function resolveStoredFile(
  rootId: string,
  fileName: string,
): Promise<{ absPath: string; mime: string; size: number } | null> {
  if (!/^[a-f0-9]{8,64}\.[a-z0-9]{2,5}$/i.test(fileName)) return null;
  const dir = await storeDir(rootId);
  const abs = path.resolve(dir, fileName);
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
