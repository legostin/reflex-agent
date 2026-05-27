import { NextRequest } from "next/server";
import {
  readSuggestionsCache,
  regenerateSuggestions,
} from "@/lib/server/ai-suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — return the cached suggestions (may be stale; client decides what to
 * show via the `generatedAt` timestamp).
 * POST — force regeneration via the configured `quick` assignment.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const cache = await readSuggestionsCache(id);
  return Response.json({ ok: true, cache });
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const result = await regenerateSuggestions(id);
  if (!result.ok) {
    const status = "needsKey" in result && result.needsKey ? 412 : 500;
    return Response.json(result, { status });
  }
  return Response.json({ ok: true, cache: result.cache });
}
