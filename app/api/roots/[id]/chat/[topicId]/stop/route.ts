import { NextRequest } from "next/server";
import { agentManager } from "@/lib/server/agents/manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Interrupt every running agent attached to the topic. Returns immediately;
 * the UI sees `agent-end` events through its SSE stream.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; topicId: string }> },
): Promise<Response> {
  const { topicId } = await ctx.params;
  const result = await agentManager.stopTopic(topicId);
  return Response.json({ ok: true, ...result });
}
