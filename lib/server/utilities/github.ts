import "server-only";
import { z } from "zod";
import { ManifestSchema, type Manifest, type UtilityScope } from "./types";
import { installUtility } from "./store";
import { buildUtility } from "./build";
import { getUtility } from "./store";

/**
 * GitHub-hosted utility installer. Supports public repos only in v1; auth
 * tokens can be added later. URL formats accepted:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/<ref>
 *   github:owner/repo
 *   github:owner/repo@<ref>
 *
 * Required repo layout:
 *   manifest.json     — utility manifest
 *   ui.tsx            — entry component (path may differ if manifest.ui set)
 *   README.md         — optional
 *   icon.png          — optional, ≤32KB
 *   actions/*.ts      — optional server actions
 */

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 32 * 1024;

interface ParsedSource {
  owner: string;
  repo: string;
  ref: string;
}

export interface GithubPreview {
  source: ParsedSource & { sha: string };
  manifest: Manifest;
  files: Record<string, string>;
  /** Bytes by file for the UI to surface in the install dialog. */
  sizes: Record<string, number>;
}

export type GithubError = { ok: false; error: string };
export type GithubPreviewResult =
  | { ok: true; preview: GithubPreview }
  | GithubError;

export async function previewFromGithub(
  url: string,
): Promise<GithubPreviewResult> {
  let parsed: ParsedSource;
  try {
    parsed = parseGithubUrl(url);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const sha = await resolveCommitSha(parsed);
    const fixed = { ...parsed, sha };
    const { manifest, files, sizes } = await fetchUtilityFiles(fixed);
    return { ok: true, preview: { source: fixed, manifest, files, sizes } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface InstallGithubResult {
  scope: UtilityScope;
  id: string;
  origin: string;
}

export async function installFromGithubConfirmed(args: {
  preview: GithubPreview;
  scope: UtilityScope;
  rootId?: string;
}): Promise<InstallGithubResult> {
  const origin = `github:${args.preview.source.owner}/${args.preview.source.repo}@${args.preview.source.sha}`;
  const installed = await installUtility({
    scope: args.scope,
    ...(args.rootId ? { rootId: args.rootId } : {}),
    manifest: args.preview.manifest,
    files: args.preview.files,
    source: {
      type: "github",
      origin,
      fetchedAt: new Date().toISOString(),
      installedBy: "github-installer",
    },
  });
  await buildUtility(installed);
  return { scope: installed.scope, id: installed.manifest.id, origin };
}

export interface UpdateCheckResult {
  upToDate: boolean;
  currentSha?: string;
  latestSha?: string;
  /** Set when `upToDate === false` — manifest fetched from the new ref. */
  preview?: GithubPreview;
}

export async function checkGithubUpdate(
  scope: UtilityScope,
  id: string,
  rootId?: string,
): Promise<UpdateCheckResult> {
  const util = await getUtility(scope, id, rootId);
  if (!util) throw new Error("utility not found");
  const origin = util.manifest.source?.origin;
  if (!origin || !origin.startsWith("github:")) {
    throw new Error("utility was not installed from github");
  }
  const m = /^github:([^/]+)\/([^@]+)@(.+)$/.exec(origin);
  if (!m) throw new Error(`unrecognized github origin: ${origin}`);
  const current = { owner: m[1]!, repo: m[2]!, ref: "HEAD", sha: m[3]! };
  const latestSha = await resolveCommitSha(current);
  if (latestSha === current.sha) {
    return { upToDate: true, currentSha: current.sha, latestSha };
  }
  const fixed = { ...current, sha: latestSha };
  const { manifest, files, sizes } = await fetchUtilityFiles(fixed);
  return {
    upToDate: false,
    currentSha: current.sha,
    latestSha,
    preview: { source: fixed, manifest, files, sizes },
  };
}

// ---------------------------------------------------------------------------
// internals

function parseGithubUrl(url: string): ParsedSource {
  let owner: string;
  let repo: string;
  let ref = "HEAD";
  const shorthand = /^github:([^/]+)\/([^@]+)(?:@(.+))?$/.exec(url.trim());
  if (shorthand) {
    owner = shorthand[1]!;
    repo = shorthand[2]!;
    if (shorthand[3]) ref = shorthand[3];
  } else {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error("not a valid URL");
    }
    if (u.hostname !== "github.com") {
      throw new Error("only github.com URLs are supported");
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("URL must include owner/repo");
    owner = parts[0]!;
    repo = parts[1]!.replace(/\.git$/, "");
    if (parts[2] === "tree" && parts[3]) {
      ref = parts.slice(3).join("/");
    }
  }
  return { owner, repo, ref };
}

async function resolveCommitSha(p: ParsedSource): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${p.owner}/${p.repo}/commits/${encodeURIComponent(p.ref)}`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `github: ${res.status} resolving ${p.owner}/${p.repo}@${p.ref}`,
    );
  }
  const body = (await res.json()) as { sha?: string };
  if (!body.sha) throw new Error("github returned no sha");
  return body.sha;
}

async function fetchRaw(
  p: ParsedSource & { sha: string },
  relPath: string,
  optional = false,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.sha}/${relPath}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (optional && res.status === 404) return null;
    throw new Error(`github raw: ${res.status} for ${relPath}`);
  }
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) {
    throw new Error(`file ${relPath} exceeds ${MAX_FILE_BYTES} bytes`);
  }
  return text;
}

const FilesShapeSchema = z.record(z.string(), z.string());

async function fetchUtilityFiles(
  p: ParsedSource & { sha: string },
): Promise<{
  manifest: Manifest;
  files: Record<string, string>;
  sizes: Record<string, number>;
}> {
  const manifestText = await fetchRaw(p, "manifest.json");
  if (!manifestText) throw new Error("manifest.json missing");
  const manifest = ManifestSchema.parse(JSON.parse(manifestText));
  const files: Record<string, string> = {};
  const sizes: Record<string, number> = {};

  const uiContent = await fetchRaw(p, manifest.ui);
  if (!uiContent) throw new Error(`${manifest.ui} missing`);
  files[manifest.ui] = uiContent;
  sizes[manifest.ui] = Buffer.byteLength(uiContent, "utf8");

  const readme = await fetchRaw(p, "README.md", true);
  if (readme) {
    files["README.md"] = readme;
    sizes["README.md"] = Buffer.byteLength(readme, "utf8");
  }

  // Server actions — fetch each declared entry.
  for (const action of manifest.serverActions) {
    const text = await fetchRaw(p, action.entry);
    if (!text) {
      throw new Error(`server action entry ${action.entry} missing`);
    }
    files[action.entry] = text;
    sizes[action.entry] = Buffer.byteLength(text, "utf8");
  }

  // Optional icon — fetched as base64 if present and under cap.
  const iconUrl = `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.sha}/icon.png`;
  const iconRes = await fetch(iconUrl, { signal: AbortSignal.timeout(5_000) });
  if (iconRes.ok) {
    const buf = Buffer.from(await iconRes.arrayBuffer());
    if (buf.length <= MAX_ICON_BYTES) {
      files["icon.png"] = buf.toString("base64");
      sizes["icon.png"] = buf.length;
    }
  }

  FilesShapeSchema.parse(files);
  return { manifest, files, sizes };
}
