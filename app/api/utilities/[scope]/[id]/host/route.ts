import { NextRequest, NextResponse } from "next/server";
import {
  dispatchHostCall,
  GrantRequiredError,
} from "@/lib/server/utilities/host-api";
import { getUtility } from "@/lib/server/utilities/store";
import type { UtilityScope } from "@/lib/server/utilities/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface HostCall {
  method: string;
  args: unknown;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ scope: string; id: string }> },
): Promise<Response> {
  const { scope, id } = await ctx.params;
  const rootId = req.nextUrl.searchParams.get("rootId") ?? undefined;
  if (scope !== "global" && scope !== "project") {
    return json({ ok: false, error: "bad scope" }, 400);
  }
  const util = await getUtility(scope as UtilityScope, id, rootId);
  if (!util) return json({ ok: false, error: "utility not found" }, 404);

  let body: HostCall;
  try {
    body = (await req.json()) as HostCall;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body?.method || typeof body.method !== "string") {
    return json({ ok: false, error: "missing method" }, 400);
  }

  try {
    const result = await dispatchHostCall(
      { utility: util, channel: "iframe" },
      body.method,
      body.args,
    );
    return json({ ok: true, result });
  } catch (err) {
    if (err instanceof GrantRequiredError) {
      // Structured detail lets the iframe bridge raise a JIT consent prompt.
      return json(
        { ok: false, error: err.message, grantRequest: err.grantRequest },
        400,
      );
    }
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
}

function json(payload: unknown, status = 200): Response {
  return NextResponse.json(payload, { status });
}
