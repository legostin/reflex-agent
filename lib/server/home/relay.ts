import "server-only";
import path from "node:path";

/**
 * Relay a message from a dispatched Space agent back to the central
 * dispatcher: push it to the user's channels (Telegram) AND drop a line
 * into the dispatcher thread so the web view + the dispatcher's own
 * context see it. This is the return leg of the dispatcher↔Space link.
 */
export async function relayToDispatcher(args: {
  spaceName: string;
  body: string;
  status?: "done" | "question" | "update" | "blocked";
  /** Deep link to the Space chat where the work happened. */
  link?: string;
}): Promise<void> {
  const icon =
    args.status === "done"
      ? "✅"
      : args.status === "question" || args.status === "blocked"
        ? "❓"
        : "📨";

  // One funnel: record in the dispatcher thread + mirror to channels (gated by
  // settings.notify.mirrorDispatcher). Same path as every other pushed notice.
  const { dispatch } = await import("./dispatch");
  await dispatch({
    title: `${icon} ${args.spaceName}`,
    body: args.body,
    ...(args.link ? { link: args.link } : {}),
  });
}

export function spaceNameFromPath(rootPath: string): string {
  return path.basename(rootPath) || rootPath;
}
