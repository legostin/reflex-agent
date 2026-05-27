import { NextRequest } from "next/server";
import { getRoot } from "@/lib/registry";
import { agentManager } from "@/lib/server/agents/manager";
import { readEvents } from "@/lib/server/agents/events-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE subscription to a topic's event log.
 *
 * Query params:
 *   since=<seq>  - replay events with seq > since first; then live
 *
 * The client first hydrates from the persisted log (server-rendered initial
 * state covers this) and then opens this stream to catch up + receive live
 * events. The stream survives client disconnect: when the user reopens the
 * tab, replay-from-`since` brings them up to date.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; topicId: string }> },
): Promise<Response> {
  const { id: rootId, topicId } = await ctx.params;
  const entry = await getRoot(rootId);
  if (!entry) return sseError("Root not found", 404);
  const since = parseSince(req.nextUrl.searchParams.get("since"));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // 1) replay any events the client may have missed
      try {
        const events = await readEvents(entry.path, topicId);
        for (const ev of events) {
          if (ev.seq > since) send("event", ev);
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // 2) subscribe to live events
      const unsubscribe = agentManager.subscribeTopic(topicId, (event) => {
        if (event.seq > since) send("event", event);
      });

      // 3) heartbeat so proxies don't kill the connection
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 25_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function parseSince(raw: string | null): number {
  if (!raw) return -1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : -1;
}

function sseError(message: string, status: number): Response {
  const body = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}
