"use server";

import { revalidatePath } from "next/cache";
import {
  beginAuthorize,
  getAccessToken,
} from "./oauth/flow";
import {
  deleteOAuthClient,
  deleteOAuthTokens,
  getOAuthClient,
  listOAuthStatuses,
  saveOAuthClient,
  type OAuthStatus,
} from "./oauth/store";
import {
  addCustomOAuthProvider,
  getOAuthProvider,
  isOAuthProviderId,
  listOAuthProviders,
  removeCustomOAuthProvider,
  updateCustomOAuthProvider,
  OAuthProviderDefSchema,
  type OAuthProviderDef,
  type OAuthProviderEntry,
  type OAuthProviderId,
} from "./oauth/providers";

export type ListOAuthStatusesResult =
  | { ok: true; statuses: OAuthStatus[] }
  | { ok: false; error: string };

export async function listOAuthStatusesAction(): Promise<ListOAuthStatusesResult> {
  try {
    return { ok: true, statuses: await listOAuthStatuses() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveOAuthClientAction(args: {
  provider: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(await isOAuthProviderId(args.provider))) {
      return { ok: false, error: `unknown provider: ${args.provider}` };
    }
    if (!args.clientId.trim()) {
      return { ok: false, error: "client_id is required" };
    }
    await saveOAuthClient(args.provider, {
      clientId: args.clientId.trim(),
      ...(args.clientSecret?.trim()
        ? { clientSecret: args.clientSecret.trim() }
        : {}),
      ...(args.scopes && args.scopes.length > 0 ? { scopes: args.scopes } : {}),
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteOAuthClientAction(
  provider: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(await isOAuthProviderId(provider))) {
      return { ok: false, error: `unknown provider: ${provider}` };
    }
    await deleteOAuthClient(provider);
    await deleteOAuthTokens(provider);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disconnectOAuthAction(
  provider: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(await isOAuthProviderId(provider))) {
      return { ok: false, error: `unknown provider: ${provider}` };
    }
    await deleteOAuthTokens(provider);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type BeginOAuthResult =
  | { ok: true; authorizeUrl: string; state: string }
  | { ok: false; error: string };

export async function beginOAuthAction(
  provider: string,
  scopes?: string[],
): Promise<BeginOAuthResult> {
  try {
    if (!(await isOAuthProviderId(provider))) {
      return { ok: false, error: `unknown provider: ${provider}` };
    }
    const result = await beginAuthorize(provider, scopes);
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getOAuthClientAction(provider: string): Promise<
  | {
      ok: true;
      client: { clientId: string; hasSecret: boolean; scopes: string[] } | null;
      defaultScopes: string[];
      setupHint: string;
      consoleUrl: string;
      needsClientSecret: boolean;
      label: string;
      setupSteps: OAuthProviderDef["setupSteps"];
    }
  | { ok: false; error: string }
> {
  try {
    const def = await getOAuthProvider(provider);
    if (!def) {
      return { ok: false, error: `unknown provider: ${provider}` };
    }
    const c = await getOAuthClient(provider);
    return {
      ok: true,
      client: c
        ? {
            clientId: c.clientId,
            hasSecret: !!c.clientSecret,
            scopes: c.scopes ?? [],
          }
        : null,
      defaultScopes: def.defaultScopes,
      setupHint: def.setupHint,
      consoleUrl: def.consoleUrl,
      needsClientSecret: def.needsClientSecret,
      label: def.label,
      setupSteps: def.setupSteps,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ListOAuthProvidersResult =
  | { ok: true; providers: OAuthProviderEntry[] }
  | { ok: false; error: string };

export async function listOAuthProvidersAction(): Promise<ListOAuthProvidersResult> {
  try {
    return { ok: true, providers: await listOAuthProviders() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function addCustomOAuthProviderAction(
  raw: unknown,
): Promise<{ ok: true; provider: OAuthProviderDef } | { ok: false; error: string }> {
  try {
    const def = OAuthProviderDefSchema.parse(raw);
    await addCustomOAuthProvider(def);
    revalidatePath("/settings");
    return { ok: true, provider: def };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateCustomOAuthProviderAction(
  id: string,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const patch = OAuthProviderDefSchema.partial().parse(raw);
    await updateCustomOAuthProvider(id, patch);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removeCustomOAuthProviderAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await removeCustomOAuthProvider(id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Smoke check that a stored authorization actually yields a usable token.
 * Helpful for diagnosing expired refresh tokens before the user tries to
 * use the related MCP server.
 */
export async function probeOAuthAction(
  provider: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await isOAuthProviderId(provider))) {
      return { ok: false, error: `unknown provider: ${provider}` };
    }
    await getAccessToken(provider as OAuthProviderId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
