import "server-only";
import { getApiKey, getApiKeyMeta } from "../api-keys";

/**
 * Thin wrapper around Gemini's discovery + generation endpoints.
 *
 * Google deprecates model versions silently (e.g. `gemini-2.0-flash` started
 * 404'ing for "new users" in 2026-Q2), so we never hardcode names — instead
 * we hit `GET /v1beta/models` to discover what's available, cache for an
 * hour, and pick a sensible default for the user's task.
 */

export interface GeminiModel {
  /** Full resource name, e.g. "models/gemini-2.5-flash". */
  name: string;
  /** Short id without the "models/" prefix — what we pass to URL paths. */
  id: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods: string[];
}

interface CacheEntry {
  fetchedAt: number;
  models: GeminiModel[];
}

declare global {
  // eslint-disable-next-line no-var
  var __reflexGeminiModelsCache: Map<string, CacheEntry> | undefined;
}

const CACHE: Map<string, CacheEntry> =
  globalThis.__reflexGeminiModelsCache ?? new Map();
globalThis.__reflexGeminiModelsCache = CACHE;

const TTL_MS = 60 * 60 * 1000;

export async function listGeminiModels(opts?: {
  /** Force a fresh fetch even if cache is warm. */
  refresh?: boolean;
}): Promise<GeminiModel[]> {
  const apiKey = await getApiKey("gemini");
  if (!apiKey) throw new Error("Gemini API key not configured");
  const cacheKey = apiKey.slice(0, 16);
  const hit = CACHE.get(cacheKey);
  if (!opts?.refresh && hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.models;
  }
  const out: GeminiModel[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `models.list HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        description?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!m.name) continue;
      const methods = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) continue;
      // Skip embeddings / image-only models — we want chat/multimodal text.
      const lowName = m.name.toLowerCase();
      if (lowName.includes("embedding")) continue;
      if (lowName.includes("aqa")) continue;
      out.push({
        name: m.name,
        id: m.name.replace(/^models\//, ""),
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.description ? { description: m.description } : {}),
        ...(m.inputTokenLimit !== undefined
          ? { inputTokenLimit: m.inputTokenLimit }
          : {}),
        ...(m.outputTokenLimit !== undefined
          ? { outputTokenLimit: m.outputTokenLimit }
          : {}),
        supportedGenerationMethods: methods,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  out.sort(modelRank);
  CACHE.set(cacheKey, { fetchedAt: Date.now(), models: out });
  return out;
}

/**
 * Sort order — fastest/cheapest sensible default first:
 *   1. "*-flash-latest" (Google's rolling alias)
 *   2. "*-flash" but not "*-lite" (regular flash)
 *   3. "*-flash-lite" (small, very fast)
 *   4. "*-pro-latest" / "*-pro" (large, smarter, slower)
 *   5. everything else
 * Within a tier, newer version numbers win.
 */
function modelRank(a: GeminiModel, b: GeminiModel): number {
  const ta = tier(a.id);
  const tb = tier(b.id);
  if (ta !== tb) return ta - tb;
  // newer version number first: gemini-2.5- > gemini-2.0- > gemini-1.5-
  const va = versionScore(a.id);
  const vb = versionScore(b.id);
  if (va !== vb) return vb - va;
  return a.id.localeCompare(b.id);
}

function tier(id: string): number {
  if (id.endsWith("flash-latest")) return 0;
  if (id.includes("flash") && !id.includes("lite")) return 1;
  if (id.includes("flash-lite")) return 2;
  if (id.endsWith("pro-latest") || id.includes("pro")) return 3;
  return 4;
}

function versionScore(id: string): number {
  const m = /gemini-(\d+)\.(\d+)/.exec(id);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

/**
 * Returns the model id we should use for a given task. Honors the user's
 * saved preference; otherwise picks the top entry from the sorted catalog;
 * absolute fallback is `gemini-flash-latest` (Google's rolling alias that
 * usually resolves to something usable).
 */
export async function resolveGeminiModel(
  task: "general" | "video" = "general",
): Promise<string> {
  const meta = await getApiKeyMeta("gemini");
  if (task === "video" && meta?.videoModel) return meta.videoModel;
  if (meta?.model) return meta.model;
  try {
    const models = await listGeminiModels();
    if (models.length > 0) return models[0]!.id;
  } catch {
    // ignore — fall through to the static default
  }
  return "gemini-flash-latest";
}

export interface GenerateContentInput {
  model: string;
  apiKey: string;
  /** Raw `contents` payload — caller controls parts (text, file_data, …). */
  contents: unknown;
  generationConfig?: unknown;
}

export async function geminiGenerateContent(args: GenerateContentInput): Promise<{
  text: string;
  raw: unknown;
}> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: args.contents,
      ...(args.generationConfig
        ? { generationConfig: args.generationConfig }
        : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  const data = JSON.parse(text) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }
  const out = (data.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return { text: out, raw: data };
}
