import { NextRequest } from "next/server";
import { agentManager } from "@/lib/server/agents/manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PermissionBody {
  kind: "permission";
  requestId: string;
  decision: "allow" | "deny";
  scope?: "once" | "always";
  tool?: string;
}

interface AnswerBody {
  kind: "answer";
  questionId: string;
  answer: string;
}

interface McpAddBody {
  kind: "mcp-add";
  requestId: string;
  decision: "approve" | "reject";
  secretValues?: Record<string, string>;
}

type RespondBody = PermissionBody | AnswerBody | McpAddBody;

/**
 * Unified endpoint for permission decisions and question answers. Routes to
 * the matching AgentManager method, which records the decision and kicks off
 * a continuation turn so the agent keeps going.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as RespondBody | null;
  if (!body || !("kind" in body)) {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  try {
    if (body.kind === "permission") {
      if (!body.requestId || !body.decision) {
        return Response.json(
          { ok: false, error: "Missing requestId or decision" },
          { status: 400 },
        );
      }
      await agentManager.respondPermission(agentId, {
        requestId: body.requestId,
        decision: body.decision,
        ...(body.scope ? { scope: body.scope } : {}),
        ...(body.tool ? { tool: body.tool } : {}),
      });
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.kind === "answer") {
      if (!body.questionId || typeof body.answer !== "string") {
        return Response.json(
          { ok: false, error: "Missing questionId or answer" },
          { status: 400 },
        );
      }
      await agentManager.respondQuestion(agentId, {
        questionId: body.questionId,
        answer: body.answer,
      });
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.kind === "mcp-add") {
      if (!body.requestId || !body.decision) {
        return Response.json(
          { ok: false, error: "Missing requestId or decision" },
          { status: 400 },
        );
      }
      await agentManager.respondMcpAdd(agentId, {
        requestId: body.requestId,
        decision: body.decision,
        ...(body.secretValues ? { secretValues: body.secretValues } : {}),
      });
      return Response.json({ ok: true }, { status: 202 });
    }
    return Response.json(
      { ok: false, error: "Unknown kind" },
      { status: 400 },
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
