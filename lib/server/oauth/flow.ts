import "server-only";
import { randomBytes, createHash } from "node:crypto";
import {
  OAUTH_REDIRECT_URI,
  getOAuthProvider,
  type OAuthProviderId,
  type OAuthProviderDef,
} from "./providers";
import {
  getOAuthClient,
  getOAuthTokens,
  saveOAuthTokens,
  type OAuthClient,
  type OAuthTokens,
} from "./store";

/**
 * OAuth 2.0 Authorization Code flow with PKCE (where supported).
 *
 * State machine:
 *   1. caller calls `beginAuthorize(provider, scopes?)` → gets
 *      `{authorizeUrl, state}`. We stash a `code_verifier` in an in-memory
 *      Map keyed by `state` so the callback can complete PKCE.
 *   2. caller opens `authorizeUrl` in the browser.
 *   3. vendor redirects to `/api/oauth/callback?code=…&state=…`.
 *   4. callback handler calls `completeAuthorize(state, code)` → exchanges
 *      code for tokens, persists, returns provider id.
 *
 * Refresh is opportunistic: `getAccessToken(provider)` returns the cached
 * token if it's still valid (with 60 s skew), otherwise hits the token
 * endpoint with `refresh_token` and updates the file.
 */

interface PendingAuth {
  provider: OAuthProviderId;
  codeVerifier?: string;
  scopes: string[];
  createdAt: number;
}

// Singleton on globalThis so HMR doesn't drop in-flight authorizations.
declare global {
  // eslint-disable-next-line no-var
  var __reflexOAuthPending: Map<string, PendingAuth> | undefined;
}
const PENDING: Map<string, PendingAuth> =
  globalThis.__reflexOAuthPending ?? new Map();
globalThis.__reflexOAuthPending = PENDING;

const STATE_TTL_MS = 15 * 60 * 1000;

function sweep(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, v] of PENDING) {
    if (v.createdAt < cutoff) PENDING.delete(k);
  }
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface BeginAuthorizeResult {
  authorizeUrl: string;
  state: string;
}

export async function beginAuthorize(
  provider: OAuthProviderId,
  scopesOverride?: string[],
): Promise<BeginAuthorizeResult> {
  sweep();
  const def = await getOAuthProvider(provider);
  if (!def) throw new Error(`unknown provider: ${provider}`);
  const client = await getOAuthClient(provider);
  if (!client) {
    throw new Error(
      `OAuth client for "${provider}" is not configured — set client_id/secret in Settings → OAuth first`,
    );
  }
  const state = base64url(randomBytes(24));
  const scopes =
    scopesOverride && scopesOverride.length > 0
      ? scopesOverride
      : client.scopes && client.scopes.length > 0
        ? client.scopes
        : def.defaultScopes;

  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    state,
    ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
    ...(def.extraAuthorizeParams ?? {}),
  });

  let codeVerifier: string | undefined;
  if (def.supportsPKCE) {
    const { verifier, challenge } = pkcePair();
    codeVerifier = verifier;
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }

  PENDING.set(state, {
    provider,
    ...(codeVerifier !== undefined ? { codeVerifier } : {}),
    scopes,
    createdAt: Date.now(),
  });

  const authorizeUrlBase = client.authorizeUrl ?? def.authorizeUrl;
  return {
    authorizeUrl: `${authorizeUrlBase}?${params.toString()}`,
    state,
  };
}

export interface CompleteAuthorizeResult {
  provider: OAuthProviderId;
}

export async function completeAuthorize(
  state: string,
  code: string,
): Promise<CompleteAuthorizeResult> {
  const pending = PENDING.get(state);
  if (!pending) {
    throw new Error("unknown or expired state — restart the authorization");
  }
  PENDING.delete(state);
  const def = await getOAuthProvider(pending.provider);
  if (!def) throw new Error(`unknown provider: ${pending.provider}`);
  const client = await getOAuthClient(pending.provider);
  if (!client) {
    throw new Error(`OAuth client for "${pending.provider}" disappeared`);
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: OAUTH_REDIRECT_URI,
    client_id: client.clientId,
  });
  if (def.needsClientSecret && client.clientSecret) {
    body.set("client_secret", client.clientSecret);
  }
  if (pending.codeVerifier) {
    body.set("code_verifier", pending.codeVerifier);
  }
  const tokens = await postTokenRequest(def, client, body);
  await saveOAuthTokens(pending.provider, tokens);
  return { provider: pending.provider };
}

/**
 * Returns a usable access_token. Refreshes if expired (with 60 s skew).
 * Throws if not authorized or refresh fails — caller surfaces to user.
 */
export async function getAccessToken(
  provider: OAuthProviderId,
): Promise<string> {
  const def = await getOAuthProvider(provider);
  if (!def) throw new Error(`unknown provider: ${provider}`);
  const tokens = await getOAuthTokens(provider);
  if (!tokens) {
    throw new Error(
      `provider "${provider}" not authorized — open Settings → OAuth and click Authorize`,
    );
  }
  const skewMs = 60_000;
  const expired =
    tokens.expiresAt !== undefined && tokens.expiresAt - skewMs < Date.now();
  if (!expired) return tokens.accessToken;

  if (!tokens.refreshToken) {
    throw new Error(
      `access token for "${provider}" expired and no refresh_token — re-authorize`,
    );
  }
  const client = await getOAuthClient(provider);
  if (!client) {
    throw new Error(`OAuth client for "${provider}" is not configured`);
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: client.clientId,
  });
  if (def.needsClientSecret && client.clientSecret) {
    body.set("client_secret", client.clientSecret);
  }
  const fresh = await postTokenRequest(def, client, body);
  // refresh_token may be rotated by provider; keep old if response omitted it.
  const merged: Omit<OAuthTokens, "updatedAt"> = {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? tokens.refreshToken,
    ...(fresh.expiresAt !== undefined ? { expiresAt: fresh.expiresAt } : {}),
    ...(fresh.scope ? { scope: fresh.scope } : tokens.scope ? { scope: tokens.scope } : {}),
    ...(fresh.tokenType
      ? { tokenType: fresh.tokenType }
      : tokens.tokenType
        ? { tokenType: tokens.tokenType }
        : {}),
  };
  await saveOAuthTokens(provider, merged);
  return merged.accessToken;
}

async function postTokenRequest(
  def: OAuthProviderDef,
  client: OAuthClient,
  body: URLSearchParams,
): Promise<Omit<OAuthTokens, "updatedAt">> {
  const url = client.tokenUrl ?? def.tokenUrl;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`token endpoint HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  // GitHub returns form-urlencoded by default; the rest send JSON. Sniff.
  let parsed: Record<string, unknown>;
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } else {
    const params = new URLSearchParams(text);
    parsed = {};
    for (const [k, v] of params) parsed[k] = v;
  }
  if (parsed.error) {
    throw new Error(
      `OAuth error: ${parsed.error}${
        parsed.error_description ? ` — ${parsed.error_description}` : ""
      }`,
    );
  }
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : null;
  if (!accessToken) {
    throw new Error(`token endpoint returned no access_token (${text.slice(0, 200)})`);
  }
  const expiresIn =
    typeof parsed.expires_in === "number"
      ? parsed.expires_in
      : typeof parsed.expires_in === "string"
        ? Number(parsed.expires_in)
        : undefined;
  return {
    accessToken,
    ...(typeof parsed.refresh_token === "string"
      ? { refreshToken: parsed.refresh_token }
      : {}),
    ...(expiresIn !== undefined && !Number.isNaN(expiresIn)
      ? { expiresAt: Date.now() + expiresIn * 1000 }
      : {}),
    ...(typeof parsed.scope === "string" ? { scope: parsed.scope } : {}),
    ...(typeof parsed.token_type === "string"
      ? { tokenType: parsed.token_type }
      : {}),
  };
}
