import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { getUtility } from "@/lib/server/utilities/store";
import { uiBundlePath } from "@/lib/server/utilities/build";
import type { UtilityScope } from "@/lib/server/utilities/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ scope: string; id: string }> },
): Promise<Response> {
  const { scope, id } = await ctx.params;
  const rootId = req.nextUrl.searchParams.get("rootId") ?? undefined;
  if (scope !== "global" && scope !== "project") {
    return new NextResponse("Bad scope", { status: 400 });
  }
  const util = await getUtility(scope as UtilityScope, id, rootId);
  if (!util) return new NextResponse("Not found", { status: 404 });
  try {
    const code = await fs.readFile(uiBundlePath(util.dir), "utf8");
    return new NextResponse(code, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        // The utility iframe runs sandboxed (null origin), so module-script
        // fetches are CORS-checked. These bundles are public assets — allow
        // any origin to load them.
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse(
      "// bundle missing — run rebuild",
      {
        status: 503,
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      },
    );
  }
}
