"use server";

import {
  saveApiKey,
  deleteApiKey,
  type ApiKeyProvider,
} from "@/lib/server/api-keys";

/**
 * Save / clear API keys for image-side providers (Unsplash, Pexels).
 * Kept in its own file so the settings UI doesn't pull in YouTube action
 * surface.
 */

export async function saveImageProviderKeyAction(
  provider: "unsplash" | "pexels" | "brave",
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return { ok: false, error: "API key is empty" };
    }
    await saveApiKey(provider as ApiKeyProvider, trimmed);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function clearImageProviderKeyAction(
  provider: "unsplash" | "pexels" | "brave",
): Promise<{ ok: true }> {
  await deleteApiKey(provider as ApiKeyProvider);
  return { ok: true };
}

/**
 * Check whether the Brave key is set in the api-keys store OR if it's
 * findable in the user's MCP server configs (`brave-search` server's
 * env.BRAVE_API_KEY). Lets Settings show a "key visible via MCP" hint
 * even when the dedicated api-keys slot is empty.
 */
export async function braveKeyStatusAction(): Promise<{
  ok: true;
  hasDedicated: boolean;
  viaMcp: boolean;
}> {
  const { hasApiKey } = await import("@/lib/server/api-keys");
  const { resolveBraveKey } = await import(
    "@/lib/server/images/providers/brave"
  );
  const hasDedicated = await hasApiKey("brave");
  if (hasDedicated) return { ok: true, hasDedicated: true, viaMcp: false };
  const resolved = await resolveBraveKey();
  return { ok: true, hasDedicated: false, viaMcp: resolved !== null };
}
