import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * OAuth 2.0 provider catalog.
 *
 * Two layers:
 *   1. **Built-in** — shipped with Reflex, never edited from the UI. Covers
 *      the most common services (Google, GitHub, Notion, Slack, Linear).
 *   2. **User** — stored at `~/.reflex/oauth/providers.json`, fully editable.
 *      The agent can also propose new entries via a directive (future); the
 *      user approves them in the UI.
 *
 * Consumers call `getOAuthProvider(id)` / `listOAuthProviders()` instead of
 * reading the static dict — this lets new providers appear at runtime
 * without code changes.
 */

export type OAuthProviderId = string;

/**
 * Step in the in-UI walkthrough. `body` is short prose; `copy` is the exact
 * value the user should paste into the named `field` on the provider's
 * console page (rendered as a copy-button next to the field name).
 */
export const OAuthSetupStepSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2_000).optional(),
  /** Display the field name on the provider's page (e.g. "Authorized redirect URIs"). */
  field: z.string().max(200).optional(),
  /** Exact value to paste into that field. UI renders a copy button. */
  copy: z.string().max(2_000).optional(),
  /** "Pick this radio option" — display as bold choice. */
  choice: z.string().max(200).optional(),
});
export type OAuthSetupStep = z.infer<typeof OAuthSetupStepSchema>;

export const OAuthProviderDefSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "provider id must be kebab-case (e.g. google, dropbox)",
    ),
  label: z.string().min(1).max(120),
  authorizeUrl: z.string().url(),
  tokenUrl: z.string().url(),
  defaultScopes: z.array(z.string()).default([]),
  supportsPKCE: z.boolean().default(true),
  refreshTokenSupported: z.boolean().default(true),
  extraAuthorizeParams: z.record(z.string(), z.string()).default({}),
  needsClientSecret: z.boolean().default(true),
  setupHint: z.string().default(""),
  consoleUrl: z.string().url(),
  /** Numbered walkthrough rendered in the UI alongside the catalog hint. */
  setupSteps: z.array(OAuthSetupStepSchema).default([]),
});

export type OAuthProviderDef = z.infer<typeof OAuthProviderDefSchema>;

const BUILTIN: Record<string, OAuthProviderDef> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar",
    ],
    supportsPKCE: true,
    refreshTokenSupported: true,
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    needsClientSecret: true,
    setupHint:
      "Если ещё не делал — сначала включи нужный API (Calendar/Gmail/Drive) во вкладке APIs & Services → Library.",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    setupSteps: [
      {
        title: "Открой Google Cloud Console → APIs & Services → Credentials.",
      },
      {
        title: "Нажми «+ CREATE CREDENTIALS» → «OAuth client ID».",
      },
      {
        title: "Application type",
        choice: "Web application",
        body: "Не «Desktop» — Reflex использует фиксированный localhost-redirect.",
      },
      {
        title: "Name — любое, например «Reflex».",
      },
      {
        title: "Authorized redirect URIs → ADD URI",
        field: "Authorized redirect URIs",
        copy: "http://localhost:3210/api/oauth/callback",
        body: "Точно как есть, без слэша в конце, http (не https).",
      },
      {
        title: "Жми CREATE → откроется попап с Client ID и Client Secret.",
      },
      {
        title:
          "Скопируй сюда оба значения. (Если потерял — открой клиент в Credentials, «Download JSON» или «Reset secret».)",
      },
      {
        title:
          "Перед первым Authorize убедись, что нужный API включён: APIs & Services → Library → Google Calendar API → Enable (для других сервисов — аналогично).",
      },
    ],
  },
  github: {
    id: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: ["repo", "read:user"],
    supportsPKCE: false,
    refreshTokenSupported: false,
    extraAuthorizeParams: {},
    needsClientSecret: true,
    setupHint: "Личные OAuth Apps живут в Settings → Developer settings.",
    consoleUrl: "https://github.com/settings/developers",
    setupSteps: [
      { title: "Открой github.com/settings/developers → OAuth Apps." },
      { title: "Нажми «New OAuth App»." },
      {
        title: "Application name — что угодно, например «Reflex».",
      },
      {
        title: "Homepage URL",
        field: "Homepage URL",
        copy: "http://localhost:3210",
      },
      {
        title: "Authorization callback URL",
        field: "Authorization callback URL",
        copy: "http://localhost:3210/api/oauth/callback",
      },
      { title: "Жми «Register application»." },
      {
        title: "Скопируй «Client ID» отсюда → в Reflex.",
      },
      {
        title:
          "Нажми «Generate a new client secret», скопируй значение сразу (показывается один раз) → в Reflex.",
      },
    ],
  },
  notion: {
    id: "notion",
    label: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    defaultScopes: [],
    supportsPKCE: false,
    refreshTokenSupported: false,
    extraAuthorizeParams: { owner: "user" },
    needsClientSecret: true,
    setupHint:
      "Reflex использует Public integration (с OAuth flow), не Internal.",
    consoleUrl: "https://www.notion.so/profile/integrations",
    setupSteps: [
      {
        title: "Открой notion.so/profile/integrations → «+ New integration».",
      },
      { title: "Name — «Reflex»." },
      {
        title: "Associated workspace — твой workspace.",
      },
      {
        title: "Type",
        choice: "Public",
        body: "Internal не подходит — для OAuth flow нужна публичная integration.",
      },
      { title: "Submit → integration создана. Перейди на её страницу." },
      {
        title: "В разделе «OAuth Domain & URIs» → Redirect URIs → Add URI",
        field: "Redirect URIs",
        copy: "http://localhost:3210/api/oauth/callback",
      },
      { title: "Save." },
      {
        title:
          "В «Secrets» скопируй OAuth client ID и OAuth client secret сюда.",
      },
    ],
  },
  slack: {
    id: "slack",
    label: "Slack",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    defaultScopes: ["chat:write", "channels:read"],
    supportsPKCE: false,
    refreshTokenSupported: true,
    extraAuthorizeParams: {},
    needsClientSecret: true,
    setupHint:
      "Scopes по умолчанию (chat:write, channels:read) можно расширить в OAuth & Permissions.",
    consoleUrl: "https://api.slack.com/apps",
    setupSteps: [
      {
        title: "Открой api.slack.com/apps → «Create New App» → «From scratch».",
      },
      { title: "App Name — «Reflex», выбери свой workspace → Create App." },
      {
        title:
          "В левой панели открой «OAuth & Permissions» → Redirect URLs → «Add New Redirect URL»",
        field: "Redirect URLs",
        copy: "http://localhost:3210/api/oauth/callback",
      },
      { title: "Save URLs." },
      {
        title:
          "Под Scopes → User Token Scopes добавь нужные (chat:write, channels:read и т.д. — из defaults Reflex).",
      },
      {
        title:
          "Вверху страницы Install App → разреши доступ → получишь Client ID и Client Secret в «Basic Information».",
      },
    ],
  },
  linear: {
    id: "linear",
    label: "Linear",
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    defaultScopes: ["read", "write"],
    supportsPKCE: false,
    refreshTokenSupported: true,
    extraAuthorizeParams: {},
    needsClientSecret: true,
    setupHint:
      "Личная OAuth-aplication привязывается к твоему workspace.",
    consoleUrl: "https://linear.app/settings/api/applications/new",
    setupSteps: [
      {
        title:
          "Открой linear.app/settings/api/applications/new (Settings → API → OAuth applications → Create new).",
      },
      { title: "Name — «Reflex», описание любое." },
      {
        title: "Developer URL",
        field: "Developer URL",
        copy: "http://localhost:3210",
      },
      {
        title: "Callback URLs",
        field: "Callback URLs",
        copy: "http://localhost:3210/api/oauth/callback",
      },
      {
        title:
          "Scopes — отметь read + write (или те, что нужны: issues:create и т.п.).",
      },
      { title: "Submit → копируй Client ID + Client Secret сюда." },
    ],
  },
};

export const BUILTIN_PROVIDER_IDS = Object.keys(BUILTIN) as readonly string[];

export const OAUTH_REDIRECT_URI = "http://localhost:3210/api/oauth/callback";

const STORE_PATH = path.join(
  os.homedir(),
  ".reflex",
  "oauth",
  "providers.json",
);

interface CustomFile {
  version: 1;
  providers: OAuthProviderDef[];
}

const CustomFileSchema = z.object({
  version: z.literal(1),
  providers: z.array(OAuthProviderDefSchema),
});

async function readCustom(): Promise<CustomFile> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = CustomFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { version: 1, providers: [] };
    return parsed.data;
  } catch {
    return { version: 1, providers: [] };
  }
}

async function writeCustom(data: CustomFile): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(
    STORE_PATH,
    JSON.stringify(data, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    await fs.chmod(STORE_PATH, 0o600);
  } catch {
    /* best effort */
  }
}

export interface OAuthProviderEntry {
  def: OAuthProviderDef;
  /** Whether this is built-in (immutable) or user-defined (editable). */
  origin: "builtin" | "user";
}

export async function listOAuthProviders(): Promise<OAuthProviderEntry[]> {
  const custom = await readCustom();
  const customIds = new Set(custom.providers.map((p) => p.id));
  const out: OAuthProviderEntry[] = [];
  // Built-ins first, but skip any whose id was overridden by a user entry.
  for (const id of BUILTIN_PROVIDER_IDS) {
    if (customIds.has(id)) continue;
    out.push({ def: BUILTIN[id]!, origin: "builtin" });
  }
  for (const def of custom.providers) {
    out.push({ def, origin: "user" });
  }
  return out;
}

export async function getOAuthProvider(
  id: string,
): Promise<OAuthProviderDef | null> {
  const all = await listOAuthProviders();
  return all.find((e) => e.def.id === id)?.def ?? null;
}

export async function isOAuthProviderId(id: string): Promise<boolean> {
  return (await getOAuthProvider(id)) !== null;
}

export async function addCustomOAuthProvider(
  def: OAuthProviderDef,
): Promise<void> {
  const parsed = OAuthProviderDefSchema.parse(def);
  if (BUILTIN[parsed.id] !== undefined) {
    throw new Error(
      `"${parsed.id}" is a built-in provider id — pick a different slug`,
    );
  }
  const file = await readCustom();
  if (file.providers.some((p) => p.id === parsed.id)) {
    throw new Error(`provider "${parsed.id}" already exists`);
  }
  file.providers.push(parsed);
  await writeCustom(file);
}

export async function updateCustomOAuthProvider(
  id: string,
  patch: Partial<OAuthProviderDef>,
): Promise<void> {
  if (BUILTIN[id] !== undefined) {
    throw new Error(`cannot edit built-in provider "${id}"`);
  }
  const file = await readCustom();
  const idx = file.providers.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`provider "${id}" not found`);
  const merged = OAuthProviderDefSchema.parse({
    ...file.providers[idx],
    ...patch,
    id,
  });
  file.providers[idx] = merged;
  await writeCustom(file);
}

export async function removeCustomOAuthProvider(id: string): Promise<void> {
  if (BUILTIN[id] !== undefined) {
    throw new Error(`cannot remove built-in provider "${id}"`);
  }
  const file = await readCustom();
  const next = file.providers.filter((p) => p.id !== id);
  if (next.length === file.providers.length) return;
  file.providers = next;
  await writeCustom(file);
}
