import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { resolveStoredFile } from "@/lib/server/images/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a per-root image asset by sha-named filename. Files are immutable
 * (content-addressed), so we can hand out a long max-age. Anything that
 * isn't an exact `<sha>.<ext>` match in the store dir is rejected.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ rootId: string; file: string }> },
): Promise<Response> {
  const { rootId, file } = await ctx.params;
  const resolved = await resolveStoredFile(rootId, file);
  if (!resolved) {
    return new Response("not found", { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(resolved.absPath));
  return new Response(stream as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": resolved.mime,
      "Content-Length": String(resolved.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
