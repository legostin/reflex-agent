import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { reflexRoot } from "@/lib/reflex/paths";
import { slugifyUnicode as slugify } from "@/lib/reflex/ids";
import type { KbDirective } from "./protocol";

export interface KbWriteResult {
  kind: string;
  title: string;
  /** Path relative to `.reflex/` (POSIX). */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
}

/**
 * Persist a structured KB entry into `<root>/.reflex/<kind>/<date>-<slug>.md`.
 * Frontmatter holds `title`, `kind`, `date`, `version`, plus any user-supplied
 * `meta`. The body is whatever the agent put in `body` (raw Markdown).
 */
export interface KbProvenance {
  /** Origin tag — `"utility"`, `"workflow"`, `"agent"`, etc. */
  kind: string;
  /** Identifier of the originating thing (utility id, workflow id, …). */
  id: string;
  /** Optional version stamp. */
  version?: string;
}

export async function writeKbEntry(args: {
  rootPath: string;
  directive: KbDirective;
  /** Optional source tag — recorded as `meta.createdBy` so KB viewers
   *  can show "created by utility X" badges and the user can audit who
   *  wrote what without scrolling through history. */
  provenance?: KbProvenance;
}): Promise<KbWriteResult> {
  const { rootPath, directive: d, provenance } = args;
  const kind = slugify(d.kind) || "note";
  const today = new Date().toISOString().slice(0, 10);
  const date = sanitizeDate(d.date) ?? today;
  const slugSource = d.slug && d.slug.trim() ? d.slug : d.title;
  const slug = slugify(slugSource) || "entry";
  const baseName = `${date}-${slug}`;
  const dir = path.join(reflexRoot(rootPath), kind);
  await fs.mkdir(dir, { recursive: true });
  const abs = await uniquePath(dir, baseName, ".md");
  const meta: Record<string, unknown> = {
    title: d.title,
    kind,
    date,
    version: 1,
    ...(d.meta && typeof d.meta === "object" ? d.meta : {}),
  };
  // Auto-stamp provenance LAST so callers can't accidentally spoof it
  // via directive.meta — host trustworthy field, not utility-controlled.
  if (provenance) {
    meta.createdBy = `${provenance.kind}:${provenance.id}${
      provenance.version ? "@" + provenance.version : ""
    }`;
  }
  const body = (d.body ?? "").replace(/\r\n/g, "\n").trimEnd();
  const content = matter.stringify(body ? body + "\n" : "", meta);
  await fs.writeFile(abs, content, "utf8");
  const rel = path
    .relative(reflexRoot(rootPath), abs)
    .split(path.sep)
    .join("/");
  return { kind, title: d.title, relPath: rel, absPath: abs };
}

function sanitizeDate(d?: string): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function uniquePath(
  dir: string,
  base: string,
  ext: string,
): Promise<string> {
  let candidate = path.join(dir, base + ext);
  let i = 1;
  while (await exists(candidate)) {
    if (i > 99) {
      candidate = path.join(
        dir,
        `${base}-${Date.now().toString(36)}${ext}`,
      );
      break;
    }
    candidate = path.join(dir, `${base}-${++i}${ext}`);
  }
  return candidate;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
