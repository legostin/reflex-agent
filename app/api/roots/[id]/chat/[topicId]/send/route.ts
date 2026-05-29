import { NextRequest } from "next/server";
import { getRoot } from "@/lib/registry";
import { getTopic } from "@/lib/server/topics";
import {
  startOrchestratorTurn,
  type Attachment,
} from "@/lib/server/agents/start-turn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SendBody {
  message?: string;
  attachments?: Attachment[];
}

/**
 * Trigger another turn for the topic's orchestrator. Returns 202 immediately;
 * the actual run streams events into the topic's `events.jsonl` log.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; topicId: string }> },
): Promise<Response> {
  const { id: rootId, topicId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as SendBody | null;
  const message = body?.message?.trim() ?? "";
  const attachments = Array.isArray(body?.attachments) ? body!.attachments! : [];
  if (!message && attachments.length === 0) {
    return Response.json({ ok: false, error: "Empty message" }, { status: 400 });
  }
  const entry = await getRoot(rootId);
  if (!entry) {
    return Response.json({ ok: false, error: "Root not found" }, { status: 404 });
  }
  const topic = await getTopic(entry.path, topicId);
  if (!topic) {
    return Response.json({ ok: false, error: "Topic not found" }, { status: 404 });
  }
  // If the orchestrator is blocked on a permission request, a typed message is
  // a refusal (per the user's choice): deny the pending request(s) with the
  // text as guidance and resume the agent — don't start a competing turn.
  if (message) {
    const { agentManager } = await import("@/lib/server/agents/manager");
    if (agentManager.hasPendingPermissionForTopic(topicId)) {
      const denied = await agentManager.denyPendingPermissionsForTopic(
        topicId,
        message,
      );
      return Response.json({ ok: true, denied }, { status: 202 });
    }
  }
  const result = await startOrchestratorTurn({
    rootId,
    topicId,
    message,
    attachments,
  });
  if ("error" in result) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.status ?? 500 },
    );
  }
  return Response.json({ ok: true, agentId: result.agentId }, { status: 202 });
}
