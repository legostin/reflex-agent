import "server-only";
import {
  downloadToStore,
  type StoredImage,
} from "./store";
import { generateWithGemini } from "./providers/gemini";

/**
 * Top-level image service used by host-api, chat directives, workflow steps
 * and KB modal. Routes between providers (Gemini Nano Banana / Codex
 * `$imagegen` / Unsplash / Pexels) and centralises auth + per-root storage.
 */

export type GenProvider = "gemini" | "codex";
export type SearchProvider = "unsplash" | "pexels" | "brave";

export interface GenerateImageInput {
  rootId: string;
  prompt: string;
  provider?: GenProvider;
  aspectRatio?: string;
  size?: string; // pass-through hint; Gemini ignores, Codex respects
  referenceImageUrls?: string[];
  alt?: string;
}

export interface GenerateImageResult {
  urlPath: string;
  sha: string;
  mime: string;
  size: number;
  provider: GenProvider;
}

export interface SearchImagesInput {
  query: string;
  provider?: SearchProvider;
  count?: number;
}

export interface SearchImageHit {
  url: string;
  thumb: string;
  attribution: { name: string; link: string };
  width?: number;
  height?: number;
  provider: SearchProvider;
}



export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const provider = input.provider ?? "gemini";
  let stored: StoredImage;
  if (provider === "gemini") {
    stored = await generateWithGemini({
      rootId: input.rootId,
      prompt: input.prompt,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      ...(input.referenceImageUrls
        ? { referenceImageUrls: input.referenceImageUrls }
        : {}),
    });
  } else if (provider === "codex") {
    // Lazy-loaded so we don't pay the codex-runtime cost when only Gemini is used.
    const mod = await import("./providers/codex");
    stored = await mod.generateWithCodex({
      rootId: input.rootId,
      prompt: input.prompt,
      ...(input.size ? { size: input.size } : {}),
    });
  } else {
    throw new Error(`unknown image provider: ${provider as string}`);
  }
  return {
    urlPath: stored.urlPath,
    sha: stored.sha,
    mime: stored.mime,
    size: stored.size,
    provider,
  };
}

export async function searchImages(
  input: SearchImagesInput,
): Promise<SearchImageHit[]> {
  const count = Math.max(1, Math.min(24, input.count ?? 12));
  // Auto-select when caller doesn't pin a provider: prefer Brave for
  // breadth (entire web), fall back to Unsplash/Pexels for stock-only
  // when only those keys are configured. This keeps utility code free
  // of provider-availability checks.
  const provider = input.provider ?? (await pickBestSearchProvider());
  if (provider === "unsplash") {
    const mod = await import("./providers/unsplash");
    return mod.searchUnsplash({ query: input.query, count });
  }
  if (provider === "pexels") {
    const mod = await import("./providers/pexels");
    return mod.searchPexels({ query: input.query, count });
  }
  if (provider === "brave") {
    const mod = await import("./providers/brave");
    return mod.searchBrave({ query: input.query, count });
  }
  throw new Error(`unknown image search provider: ${provider as string}`);
}

async function pickBestSearchProvider(): Promise<SearchProvider> {
  const { hasApiKey } = await import("@/lib/server/api-keys");
  // Brave: also check the MCP-derived key so users who configured the
  // Brave Search MCP server get image search "for free" without
  // re-pasting the key into Settings → Images.
  const { resolveBraveKey } = await import("./providers/brave");
  if (await resolveBraveKey()) return "brave";
  if (await hasApiKey("unsplash")) return "unsplash";
  if (await hasApiKey("pexels")) return "pexels";
  // Nothing configured → still try Brave first; the provider surfaces
  // a clear "key not configured" error instead of a silent empty list.
  return "brave";
}

export async function attachRemote(args: {
  rootId: string;
  sourceUrl: string;
}): Promise<StoredImage> {
  return downloadToStore(args.rootId, args.sourceUrl);
}
