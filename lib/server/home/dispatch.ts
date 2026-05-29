import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { homeRootEntry } from "@/lib/registry";
import type { NotifyPayload } from "@/lib/server/notify";

/**
 * The single funnel for pushing a message to the user.
 *
 * Every pushed notification (workflow `notify` step, the agent's
 * `<<reflex:notify>>` marker, scheduler outcomes, Space-agent reports) goes
 * through `dispatch()`, which records ONE line in the dispatcher thread — so it
 * is always visible in-app and in the dispatcher's own context. A separate
 * forwarder (`mirrorDispatcher`) then mirrors new dispatcher notification lines
 * out to the configured channels (Telegram, later Slack), gated by
 * `settings.notify.mirrorDispatcher`. The dispatcher is the source of truth;
 * channels are a mirror.
 *
 * This is deliberately decoupled from the Telegram bridge's live turn
 * streaming (which mirrors interactive dispatcher *turns*): the forwarder only
 * touches `system/notification` events, the turn streamer only touches
 * `assistant-delta`, so they never double-send and keep separate cursors.
 */

const NOTIFICATION_SUBTYPE = "notification";

function cursorPath(): string {
  return path.join(homeRootEntry().path, "dispatcher-mirror.json");
}

async function readCursor(): Promise<number | null> {
  try {
    const raw = await fs.readFile(cursorPath(), "utf8");
    const v = (JSON.parse(raw) as { mirroredCount?: number }).mirroredCount;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

async function writeCursor(mirroredCount: number): Promise<void> {
  await fs.mkdir(path.dirname(cursorPath()), { recursive: true });
  await fs.writeFile(cursorPath(), JSON.stringify({ mirroredCount }), "utf8");
}

/** Compose a payload into one markdown line for the dispatcher + channels. */
function compose(payload: NotifyPayload): string {
  return [payload.title ? `**${payload.title}**` : "", payload.body, payload.link ?? ""]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Push a notification: record it in the dispatcher thread, then kick the
 * mirror so it reaches the user's channels promptly (the periodic mirror tick
 * is the safety net). Never throws — notification is best-effort.
 */
export async function dispatch(payload: NotifyPayload): Promise<void> {
  if (!payload.body?.trim()) return;
  try {
    const { getDispatcherTopic } = await import("./dispatcher");
    const { appendEventSeq } = await import("@/lib/server/agents/events-log");
    const d = await getDispatcherTopic();
    await appendEventSeq(d.rootPath, d.topicId, {
      type: "system",
      subtype: NOTIFICATION_SUBTYPE,
      text: compose(payload),
      agentId: "dispatcher-notify",
      ts: new Date().toISOString(),
      seq: 0,
    });
  } catch (err) {
    console.error(
      "[dispatch] record failed:",
      err instanceof Error ? err.message : err,
    );
  }
  // Mirror promptly (idempotent; the scheduler tick re-runs it as a safety net).
  void mirrorDispatcher();
}

let mirroring = false;

/**
 * Forward new dispatcher notification lines to the configured channels.
 * Cursor-based + at-most-once (advances before sending), idempotent, guarded
 * against overlap. When mirroring is disabled the cursor still advances (stay
 * caught up) so re-enabling pushes only future lines, never a backlog.
 */
export async function mirrorDispatcher(): Promise<void> {
  if (mirroring) return;
  mirroring = true;
  try {
    const { getDispatcherTopic } = await import("./dispatcher");
    const { readEvents } = await import("@/lib/server/agents/events-log");
    const { loadSettings } = await import("@/lib/settings/store");

    const d = await getDispatcherTopic();
    const events = await readEvents(d.rootPath, d.topicId);
    const cursor = await readCursor();

    // First ever: seed silently — never dump pre-existing history.
    if (cursor === null) {
      await writeCursor(events.length);
      return;
    }
    if (cursor >= events.length) return;

    const settings = await loadSettings();
    if (settings.notify?.mirrorDispatcher === false) {
      await writeCursor(events.length); // stay caught up while disabled
      return;
    }

    const pending = events.slice(cursor).filter(
      (e) => e.type === "system" && e.subtype === NOTIFICATION_SUBTYPE,
    );
    // Advance the cursor BEFORE sending (at-most-once across a crash).
    await writeCursor(events.length);

    if (pending.length === 0) return;
    const { notify } = await import("@/lib/server/notify");
    for (const e of pending) {
      const text = (e as { text?: string }).text ?? "";
      if (text.trim()) await notify({ body: text });
    }
  } catch (err) {
    console.error(
      "[dispatcher-mirror]",
      err instanceof Error ? err.message : err,
    );
  } finally {
    mirroring = false;
  }
}
