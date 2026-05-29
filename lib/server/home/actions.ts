"use server";

import { getDispatcherTopic } from "./dispatcher";
import { startOrchestratorTurn, type Attachment } from "@/lib/server/agents/start-turn";

/**
 * Send a message to the central dispatcher thread (the home-Space chat
 * shared with Telegram). Creates the dispatcher topic on first use.
 * Returns the chat URL so the caller can navigate into it.
 */
export async function sendToDispatcherAction(
  message: string,
  attachments: Attachment[] = [],
): Promise<
  | { ok: true; rootId: string; topicId: string; href: string }
  | { ok: false; error: string }
> {
  try {
    const d = await getDispatcherTopic();
    if (message.trim() || attachments.length > 0) {
      const res = await startOrchestratorTurn({
        rootId: d.rootId,
        topicId: d.topicId,
        message,
        attachments,
        origin: "web",
      });
      if ("error" in res) return { ok: false, error: res.error };
    }
    return {
      ok: true,
      rootId: d.rootId,
      topicId: d.topicId,
      href: `/roots/${d.rootId}/chat/${d.topicId}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve the dispatcher chat URL (getOrCreate, no message). */
export async function dispatcherHrefAction(): Promise<{ href: string }> {
  const d = await getDispatcherTopic();
  return { href: `/roots/${d.rootId}/chat/${d.topicId}` };
}
