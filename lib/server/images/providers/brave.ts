import "server-only";
import { getApiKey } from "@/lib/server/api-keys";
import { getMcpServer } from "@/lib/server/mcp-registry";
import type { SearchImageHit } from "../service";

const ENDPOINT = "https://api.search.brave.com/res/v1/images/search";

export interface BraveSearchInput {
  query: string;
  count: number;
}

interface BraveImageResult {
  title?: string;
  url?: string;
  source?: string;
  thumbnail?: { src?: string };
  properties?: { url?: string };
  meta_url?: { hostname?: string };
}

interface BraveImageResponse {
  results?: BraveImageResult[];
}

/**
 * Brave Image Search. Uses the Brave Search API (image variant). We pull
 * the API key from three places in order:
 *   1. `~/.reflex/api-keys/brave.json` (Settings → Images → Brave)
 *   2. The MCP server `brave-search`'s `env.BRAVE_API_KEY` (zero-config
 *      if the user already wired Brave Search MCP for text search)
 *   3. `process.env.BRAVE_API_KEY`
 *
 * Brave's API requires attributing the source page; we surface the
 * source hostname + page URL via the standard `attribution` field.
 */
export async function searchBrave(
  input: BraveSearchInput,
): Promise<SearchImageHit[]> {
  const key = await resolveBraveKey();
  if (!key) {
    throw new Error(
      "Brave API key не найден. Подключи Brave Search MCP в Settings или добавь ключ в Settings → Картинки.",
    );
  }
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(Math.min(input.count, 50)));
  url.searchParams.set("safesearch", "strict");
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Brave image search ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as BraveImageResponse;
  const out: SearchImageHit[] = [];
  for (const r of json.results ?? []) {
    const full = r.properties?.url;
    const thumb = r.thumbnail?.src;
    if (!full || !thumb) continue;
    const sourcePage = r.url ?? "";
    const sourceName =
      r.source || r.meta_url?.hostname || hostnameOf(sourcePage) || "Brave";
    out.push({
      url: full,
      thumb,
      attribution: { name: sourceName, link: sourcePage || full },
      provider: "brave",
    });
  }
  return out;
}

export async function resolveBraveKey(): Promise<string | null> {
  const stored = await getApiKey("brave");
  if (stored) return stored;
  const fromMcp = await readBraveKeyFromMcp();
  if (fromMcp) return fromMcp;
  const envKey = process.env.BRAVE_API_KEY;
  if (envKey && envKey.length > 0) return envKey;
  return null;
}

async function readBraveKeyFromMcp(): Promise<string | null> {
  // Try the canonical id `brave-search` first; fall back to any registered
  // server whose env carries a BRAVE_API_KEY.
  const direct = await getMcpServer("brave-search");
  const candidates = direct ? [direct] : [];
  if (!direct) {
    const { listMcpServers } = await import("@/lib/server/mcp-registry");
    for (const s of await listMcpServers()) {
      if (
        s.config.transport === "stdio" &&
        s.config.env &&
        typeof s.config.env.BRAVE_API_KEY === "string" &&
        s.config.env.BRAVE_API_KEY.length > 0
      ) {
        candidates.push(s);
      }
    }
  }
  for (const s of candidates) {
    if (s.config.transport !== "stdio") continue;
    const k = s.config.env?.BRAVE_API_KEY;
    if (typeof k === "string" && k.length > 0) return k;
  }
  return null;
}

function hostnameOf(u: string): string | null {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}
