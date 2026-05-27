import "server-only";
import { getApiKey } from "@/lib/server/api-keys";
import type { SearchImageHit } from "../service";

const ENDPOINT = "https://api.unsplash.com/search/photos";

export interface UnsplashSearchInput {
  query: string;
  count: number;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; thumb: string; small: string };
  user: { name: string; links: { html: string } };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

export async function searchUnsplash(
  input: UnsplashSearchInput,
): Promise<SearchImageHit[]> {
  const key = await getApiKey("unsplash");
  if (!key) {
    throw new Error(
      "Unsplash Access Key is not configured. Open Settings → Images.",
    );
  }
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", input.query);
  url.searchParams.set("per_page", String(input.count));
  url.searchParams.set("orientation", "landscape");
  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${key}`,
      "Accept-Version": "v1",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Unsplash search ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as UnsplashSearchResponse;
  return (json.results ?? []).map((p) => ({
    url: p.urls.regular,
    thumb: p.urls.thumb,
    attribution: {
      name: p.user.name,
      link: `${p.user.links.html}?utm_source=reflex&utm_medium=referral`,
    },
    width: p.width,
    height: p.height,
    provider: "unsplash",
  }));
}
