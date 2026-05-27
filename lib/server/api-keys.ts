import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Per-provider API keys (Gemini, OpenAI, Anthropic, …). Each lives in its
 * own JSON file under `~/.reflex/api-keys/<id>.json` (mode 0600). Kept
 * separate from utility secrets / OAuth tokens so the trust boundary is
 * clear — these are global, user-managed, never shown to agents directly.
 */

export type ApiKeyProvider =
  | "gemini"
  | "openai"
  | "anthropic"
  | "unsplash"
  | "pexels"
  | "brave";

export interface ApiKeyMeta {
  apiKey: string;
  /** Default model for "general" calls (text completions). */
  model?: string;
  /** Override for video / multimodal summarization. Falls back to `model`. */
  videoModel?: string;
  updatedAt: string;
}

type ApiKeyFile = ApiKeyMeta;

const ROOT = path.join(os.homedir(), ".reflex", "api-keys");

function fileFor(provider: ApiKeyProvider): string {
  return path.join(ROOT, `${provider}.json`);
}

export async function getApiKeyMeta(
  provider: ApiKeyProvider,
): Promise<ApiKeyMeta | null> {
  try {
    const raw = await fs.readFile(fileFor(provider), "utf8");
    const parsed = JSON.parse(raw) as Partial<ApiKeyFile>;
    if (typeof parsed.apiKey !== "string" || parsed.apiKey.length === 0) {
      return null;
    }
    return {
      apiKey: parsed.apiKey,
      ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      ...(typeof parsed.videoModel === "string"
        ? { videoModel: parsed.videoModel }
        : {}),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getApiKey(
  provider: ApiKeyProvider,
): Promise<string | null> {
  const meta = await getApiKeyMeta(provider);
  return meta?.apiKey ?? null;
}

async function writeMeta(
  provider: ApiKeyProvider,
  data: ApiKeyMeta,
): Promise<void> {
  const p = fileFor(provider);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await fs.chmod(p, 0o600);
  } catch {
    /* best effort */
  }
}

export async function saveApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
): Promise<void> {
  const existing = await getApiKeyMeta(provider);
  await writeMeta(provider, {
    ...(existing ?? {}),
    apiKey: apiKey.trim(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Patch the meta file without touching the key. Used for storing the
 * user's chosen default/video models for a provider.
 */
export async function patchApiKeyMeta(
  provider: ApiKeyProvider,
  patch: { model?: string | null; videoModel?: string | null },
): Promise<void> {
  const existing = await getApiKeyMeta(provider);
  if (!existing) throw new Error(`API key for "${provider}" is not saved`);
  const next: ApiKeyMeta = {
    apiKey: existing.apiKey,
    updatedAt: new Date().toISOString(),
  };
  const model = patch.model === undefined ? existing.model : patch.model ?? undefined;
  const videoModel =
    patch.videoModel === undefined
      ? existing.videoModel
      : patch.videoModel ?? undefined;
  if (model) next.model = model;
  if (videoModel) next.videoModel = videoModel;
  await writeMeta(provider, next);
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  try {
    await fs.unlink(fileFor(provider));
  } catch {
    /* missing → fine */
  }
}

export async function hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
  return (await getApiKey(provider)) !== null;
}
