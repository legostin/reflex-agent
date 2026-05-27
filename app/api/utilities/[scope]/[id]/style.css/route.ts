import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getUtility } from "@/lib/server/utilities/store";
import type { UtilityScope } from "@/lib/server/utilities/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-utility Tailwind stylesheet compiled by `buildUtility`. Scans the
 * utility's source and the host-ui primitives for class candidates and
 * writes `<dir>/style.css`. This route just serves that file.
 */
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
  if (!util) return new NextResponse("/* utility not found */", { status: 404 });
  const cssPath = path.join(util.dir, "style.css");
  try {
    const css = await fs.readFile(cssPath, "utf8");
    return new NextResponse(css, {
      headers: {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new NextResponse("/* stylesheet missing — run rebuild */", {
      status: 503,
      headers: { "Content-Type": "text/css; charset=utf-8" },
    });
  }
}
