import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  listOAuthProviders,
  type OAuthProviderId,
} from "./providers";
import { reflexHome } from "@/lib/reflex/home";

/**
 * On-disk state for OAuth — two files per provider:
 *
 *   ~/.reflex/oauth/clients/<id>.json   — client_id / client_secret the user
 *                                          entered (mode 0600).
 *   ~/.reflex/oauth/tokens/<id>.json    — current access/refresh tokens
 *                                          (mode 0600).
 *
 * Kept as separate files so token rotation doesn't rewrite the client
 * credentials and so a missing token file is unambiguously "not authorized".
 */

const ROOT = path.join(reflexHome(), "oauth");
const CLIENTS_DIR = path.join(ROOT, "clients");
const TOKENS_DIR = path.join(ROOT, "tokens");

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  /** Scopes user has narrowed down to (overrides catalog default). */
  scopes?: string[];
  /** Custom authorize URL override (rare — e.g. self-hosted Slack instance). */
  authorizeUrl?: string;
  tokenUrl?: string;
  updatedAt: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when access token expires. May be a guess if provider didn't return expires_in. */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  /** ISO timestamp of last refresh / initial fetch. */
  updatedAt: string;
}

function clientPath(id: OAuthProviderId): string {
  return path.join(CLIENTS_DIR, `${id}.json`);
}

function tokensPath(id: OAuthProviderId): string {
  return path.join(TOKENS_DIR, `${id}.json`);
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await fs.chmod(p, 0o600);
  } catch {
    // best effort
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveOAuthClient(
  id: OAuthProviderId,
  client: Omit<OAuthClient, "updatedAt">,
): Promise<void> {
  const { getOAuthProvider } = await import("./providers");
  if (!(await getOAuthProvider(id))) {
    throw new Error(`unknown provider: ${id}`);
  }
  await writeJson(clientPath(id), {
    ...client,
    updatedAt: new Date().toISOString(),
  });
}

export async function getOAuthClient(
  id: OAuthProviderId,
): Promise<OAuthClient | null> {
  return readJson<OAuthClient>(clientPath(id));
}

export async function deleteOAuthClient(id: OAuthProviderId): Promise<void> {
  try {
    await fs.unlink(clientPath(id));
  } catch {
    /* missing → fine */
  }
}

export async function saveOAuthTokens(
  id: OAuthProviderId,
  tokens: Omit<OAuthTokens, "updatedAt">,
): Promise<void> {
  await writeJson(tokensPath(id), {
    ...tokens,
    updatedAt: new Date().toISOString(),
  });
}

export async function getOAuthTokens(
  id: OAuthProviderId,
): Promise<OAuthTokens | null> {
  return readJson<OAuthTokens>(tokensPath(id));
}

export async function deleteOAuthTokens(id: OAuthProviderId): Promise<void> {
  try {
    await fs.unlink(tokensPath(id));
  } catch {
    /* missing → fine */
  }
}

export interface OAuthStatus {
  id: OAuthProviderId;
  label: string;
  hasClient: boolean;
  hasTokens: boolean;
  expiresAt?: number;
  setupHint: string;
  consoleUrl: string;
  origin: "builtin" | "user";
  setupSteps: Array<{
    title: string;
    body?: string;
    field?: string;
    copy?: string;
    choice?: string;
  }>;
}

export async function listOAuthStatuses(): Promise<OAuthStatus[]> {
  const out: OAuthStatus[] = [];
  for (const entry of await listOAuthProviders()) {
    const def = entry.def;
    const client = await getOAuthClient(def.id);
    const tokens = await getOAuthTokens(def.id);
    out.push({
      id: def.id,
      label: def.label,
      hasClient: !!client,
      hasTokens: !!tokens,
      ...(tokens?.expiresAt !== undefined
        ? { expiresAt: tokens.expiresAt }
        : {}),
      setupHint: def.setupHint,
      consoleUrl: def.consoleUrl,
      origin: entry.origin,
      setupSteps: def.setupSteps,
    });
  }
  return out;
}
