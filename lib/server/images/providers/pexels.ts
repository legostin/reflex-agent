import "server-only";
import { getApiKey } from "@/lib/server/api-keys";
import type { SearchImageHit } from "../service";

const ENDPOINT = "https://api.pexels.com/v1/search";

export interface PexelsSearchInput {
  query: string;
  count: number;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  src: { medium: string; small: string; tiny: string; large: string };
  photographer: string;
  photographer_url: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
}

export async function searchPexels(
  input: PexelsSearchInput,
): Promise<SearchImageHit[]> {
  const key = await getApiKey("pexels");
  if (!key) {
    throw new Error(
      "Pexels API Key is not configured. Open Settings → Images.",
    );
  }
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", input.query);
  url.searchParams.set("per_page", String(input.count));
  const res = await fetch(url, {
    headers: { Authorization: key },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Pexels search ${res.status}: ${txt.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as PexelsSearchResponse;
  return (json.photos ?? []).map((p) => ({
    url: p.src.large,
    thumb: p.src.tiny,
    attribution: { name: p.photographer, link: p.photographer_url },
    width: p.width,
    height: p.height,
    provider: "pexels",
  }));
}
