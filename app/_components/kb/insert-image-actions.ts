"use server";

import { writeKbEntry } from "@/lib/server/agents/kb-writer";
import { getRoot } from "@/lib/registry";
import {
  generateImage,
  searchImages,
  attachRemote,
  type GenProvider,
  type SearchProvider,
  type SearchImageHit,
} from "@/lib/server/images/service";
import { saveImageBytes } from "@/lib/server/images/store";

/**
 * Backend for the InsertImageModal — three flows (generate, search,
 * upload) that each end with a per-root image asset + an optional KB
 * entry (kind: "image"). The returned `markdown` is what the modal
 * inserts at the cursor / hands to KB.
 */

export interface GenerateActionInput {
  rootId: string;
  prompt: string;
  provider?: GenProvider;
  aspectRatio?: string;
  alt?: string;
  attachToKb?: boolean;
}

export interface SearchActionInput {
  rootId: string;
  query: string;
  provider?: SearchProvider;
  count?: number;
}

export interface AttachActionInput {
  rootId: string;
  sourceUrl: string;
  alt?: string;
  attribution?: { name: string; link: string };
  attachToKb?: boolean;
}

export interface UploadActionInput {
  rootId: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  base64: string;
  mime: string;
  alt?: string;
  attachToKb?: boolean;
}

export interface InsertImageResult {
  ok: true;
  url: string;
  sha: string;
  markdown: string;
  kbRelPath?: string;
}

export interface InsertImageError {
  ok: false;
  error: string;
}

type Outcome = InsertImageResult | InsertImageError;

export async function generateAction(
  input: GenerateActionInput,
): Promise<Outcome> {
  try {
    const res = await generateImage({
      rootId: input.rootId,
      prompt: input.prompt,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.alt ? { alt: input.alt } : {}),
    });
    const alt = sanitizeAlt(input.alt || input.prompt);
    const markdown = `![${alt}](${res.urlPath})`;
    let kbRelPath: string | undefined;
    if (input.attachToKb) {
      kbRelPath = await writeImageKbEntry(input.rootId, {
        title: input.alt || input.prompt.slice(0, 80),
        markdown,
        meta: {
          provider: res.provider,
          prompt: input.prompt,
          sha: res.sha,
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        },
      });
    }
    return {
      ok: true,
      url: res.urlPath,
      sha: res.sha,
      markdown,
      ...(kbRelPath ? { kbRelPath } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function searchAction(
  input: SearchActionInput,
): Promise<{ ok: true; results: SearchImageHit[] } | InsertImageError> {
  try {
    const results = await searchImages({
      query: input.query,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.count ? { count: input.count } : {}),
    });
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function attachAction(
  input: AttachActionInput,
): Promise<Outcome> {
  try {
    const stored = await attachRemote({
      rootId: input.rootId,
      sourceUrl: input.sourceUrl,
    });
    const alt = sanitizeAlt(input.alt || "image");
    const attributionLine = input.attribution
      ? `\n\n_Фото: [${input.attribution.name}](${input.attribution.link})_`
      : "";
    const markdown = `![${alt}](${stored.urlPath})${attributionLine}`;
    let kbRelPath: string | undefined;
    if (input.attachToKb) {
      kbRelPath = await writeImageKbEntry(input.rootId, {
        title: input.alt || "Найденная картинка",
        markdown,
        meta: {
          source: "web",
          sourceUrl: input.sourceUrl,
          sha: stored.sha,
          ...(input.attribution
            ? { author: input.attribution.name, authorUrl: input.attribution.link }
            : {}),
        },
      });
    }
    return {
      ok: true,
      url: stored.urlPath,
      sha: stored.sha,
      markdown,
      ...(kbRelPath ? { kbRelPath } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function uploadAction(
  input: UploadActionInput,
): Promise<Outcome> {
  try {
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.byteLength === 0) {
      return { ok: false, error: "Empty upload" };
    }
    if (!input.mime.startsWith("image/")) {
      return { ok: false, error: `Unsupported mime: ${input.mime}` };
    }
    const stored = await saveImageBytes(input.rootId, bytes, input.mime);
    const alt = sanitizeAlt(input.alt || "image");
    const markdown = `![${alt}](${stored.urlPath})`;
    let kbRelPath: string | undefined;
    if (input.attachToKb) {
      kbRelPath = await writeImageKbEntry(input.rootId, {
        title: input.alt || "Загруженная картинка",
        markdown,
        meta: { source: "upload", sha: stored.sha, mime: input.mime },
      });
    }
    return {
      ok: true,
      url: stored.urlPath,
      sha: stored.sha,
      markdown,
      ...(kbRelPath ? { kbRelPath } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function writeImageKbEntry(
  rootId: string,
  args: {
    title: string;
    markdown: string;
    meta: Record<string, unknown>;
  },
): Promise<string> {
  const entry = await getRoot(rootId);
  if (!entry) throw new Error(`unknown rootId: ${rootId}`);
  const written = await writeKbEntry({
    rootPath: entry.path,
    directive: {
      kind: "image",
      title: args.title,
      body: args.markdown,
      meta: args.meta,
    },
  });
  return written.relPath;
}

function sanitizeAlt(s: string): string {
  return s.replace(/[\[\]\n]/g, " ").slice(0, 200);
}
