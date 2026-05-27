import { NextRequest } from "next/server";
import { loadDashboardSnapshotAction } from "@/lib/server/dashboard-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Snapshot fetcher used by the dashboard client to refresh on SSE ticks
 * (topicsChanged, kbChanged) and on manual refresh. Keep this cheap — it's
 * called per-event.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const result = await loadDashboardSnapshotAction(id);
  return Response.json(result);
}
