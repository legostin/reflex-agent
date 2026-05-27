import { NextRequest } from "next/server";
import { beginAuthorize } from "@/lib/server/oauth/flow";
import { isOAuthProviderId } from "@/lib/server/oauth/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Kicks off an OAuth authorization. The client opens the returned
 * `authorizeUrl` in the browser; the user then comes back through
 * `/api/oauth/callback`.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { provider?: string; scopes?: string[] }
    | null;
  const provider = body?.provider;
  if (!provider || !isOAuthProviderId(provider)) {
    return Response.json(
      { ok: false, error: "unknown or missing provider" },
      { status: 400 },
    );
  }
  try {
    const result = await beginAuthorize(provider, body?.scopes);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
