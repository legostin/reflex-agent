import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexHome } from "@/lib/reflex/home";
import { loadSettings } from "@/lib/settings/store";
import {
  startOrchestratorTurn,
  type Attachment,
} from "@/lib/server/agents/start-turn";
import { agentManager } from "@/lib/server/agents/manager";
import { readEvents } from "@/lib/server/agents/events-log";
import type { NotifyPayload } from "./index";

/**
 * Telegram channel: outbound `sendMessage` + an inbound long-poll loop
 * that turns Telegram into a full chat surface for Reflex. Replies run a
 * real orchestrator turn in a persistent "Telegram" topic (so the
 * conversation has memory + KB + tools) and come back in the chat.
 *
 * The poller is a process singleton booted from `app/layout.tsx`, mirror
 * of `startScheduler()` — guarded by a global, `.unref()`'d so it never
 * holds the process open.
 */

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  rootId: string;
}

const TURN_TIMEOUT_MS = 4 * 60_000;
const POLL_TIMEOUT_S = 30; // long-poll window
const STATE_FILE = path.join(reflexHome(), "notify", "telegram-state.json");

// ---------------------------------------------------------------------------
// Outbound

function api(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendTelegram(
  cfg: TelegramConfig,
  payload: NotifyPayload,
): Promise<void> {
  const parts: string[] = [];
  if (payload.title) parts.push(`*${escapeMd(payload.title)}*`);
  parts.push(escapeMd(payload.body));
  if (payload.link) parts.push(payload.link);
  await sendMessage(cfg.botToken, cfg.chatId, parts.join("\n\n"));
}

const TG_MAX = 4000;

async function tgCall(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; result?: { message_id?: number } }> {
  try {
    const res = await fetch(api(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    return (await res.json()) as {
      ok: boolean;
      result?: { message_id?: number };
    };
  } catch {
    return { ok: false };
  }
}

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const body = text.slice(0, TG_MAX);
  const r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: body,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
  // Retry once as plain text — a stray `*`/`_` can 400 the Markdown parse.
  if (!r.ok) {
    await tgCall(token, "sendMessage", { chat_id: chatId, text: body });
  }
}

/** Send a plain-text message and return its message_id (for later edits). */
async function sendPlain(
  token: string,
  chatId: string,
  text: string,
): Promise<number | null> {
  const r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, TG_MAX),
    disable_web_page_preview: true,
  });
  return r.ok && r.result?.message_id ? r.result.message_id : null;
}

/** Edit a previously-sent message's plain text. Best-effort. */
async function editPlain(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  await tgCall(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, TG_MAX),
    disable_web_page_preview: true,
  });
}

/** Markdown-v1 escape for the few chars that break Telegram parsing. */
function escapeMd(s: string): string {
  return s.replace(/([*_`\[])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Inbound poller (singleton)

interface PollerHandle {
  running: boolean;
  stop: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __reflexTelegramPoller: PollerHandle | undefined;
}

export function startTelegramPoller(): void {
  if (globalThis.__reflexTelegramPoller) return;
  const handle: PollerHandle = { running: false, stop: false };
  globalThis.__reflexTelegramPoller = handle;
  // Detach — the loop awaits getUpdates (30s long-poll) forever.
  void loop(handle);
}

export function stopTelegramPoller(): void {
  if (globalThis.__reflexTelegramPoller) {
    globalThis.__reflexTelegramPoller.stop = true;
    globalThis.__reflexTelegramPoller = undefined;
  }
}

async function loop(handle: PollerHandle): Promise<void> {
  if (handle.running) return;
  handle.running = true;
  let offset = await readOffset();
  while (!handle.stop) {
    let cfg: TelegramConfig | null = null;
    try {
      cfg = (await loadSettings()).notify?.telegram ?? null;
    } catch {
      /* settings unreadable — back off */
    }
    if (!cfg || !cfg.enabled || !cfg.botToken) {
      await sleep(15_000); // disabled — idle-poll the config
      continue;
    }
    try {
      const updates = await getUpdates(cfg.botToken, offset);
      for (const u of updates) {
        // Process FIRST, then advance the offset. If the process dies
        // mid-turn (restart/crash), the message stays unacked and gets
        // redelivered — otherwise it'd be silently lost. The catch still
        // advances on a handler error so a poison message can't loop.
        await handleUpdate(cfg, u).catch((err) => {
          console.error(
            "[telegram] handleUpdate:",
            err instanceof Error ? err.message : err,
          );
        });
        offset = u.update_id + 1;
        await writeOffset(offset);
      }
    } catch (err) {
      console.error(
        "[telegram] getUpdates:",
        err instanceof Error ? err.message : err,
      );
      await sleep(5_000);
    }
  }
  handle.running = false;
}

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    chat?: { id: number };
  };
}

async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  const url = `${api(token, "getUpdates")}?timeout=${POLL_TIMEOUT_S}&offset=${offset}&allowed_updates=["message"]`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000),
  });
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
  return body.result ?? [];
}

async function handleUpdate(cfg: TelegramConfig, u: TgUpdate): Promise<void> {
  const chatId = u.message?.chat?.id;
  if (chatId === undefined) return;
  const photos = u.message?.photo ?? [];
  // Caption rides with photos; plain text otherwise. A bare photo gets a
  // default prompt so the agent has something to answer.
  let text = (u.message?.text ?? u.message?.caption ?? "").trim();
  if (!text && photos.length === 0) return;
  if (!text && photos.length > 0) text = "What's in this image?";

  let allowedChatId = cfg.chatId;
  // First-message auto-bind: if no chat id is configured yet, adopt the
  // sender's — the user just texts the bot once and it's connected, no
  // copy-pasting an id. Persisted so later messages match normally.
  if (!allowedChatId) {
    allowedChatId = String(chatId);
    try {
      const { loadSettings, saveSettings } = await import("@/lib/settings/store");
      const s = await loadSettings();
      await saveSettings({
        ...s,
        notify: {
          ...s.notify,
          telegram: { ...s.notify.telegram, chatId: allowedChatId },
        },
      });
    } catch {
      /* best-effort — still proceed with this message */
    }
    await sendMessage(
      cfg.botToken,
      allowedChatId,
      "Connected ✅ — I'll answer here from now on.",
    );
  }
  // Only accept messages from the (now) configured chat.
  if (String(chatId) !== String(allowedChatId)) return;

  // Telegram and the web home page are the SAME conversation — both talk
  // to the central dispatcher thread in the synthetic home Space.
  const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
  const d = await getDispatcherTopic();

  // Download the largest photo (last in the array) so the agent can see
  // it via its Read tool (native vision on both Claude Code and Codex).
  const attachments: Attachment[] = [];
  if (photos.length > 0) {
    const largest = photos[photos.length - 1]!;
    const att = await downloadTelegramPhoto(
      cfg.botToken,
      largest.file_id,
      d.rootPath,
    ).catch(() => null);
    if (att) attachments.push(att);
  }

  await streamTurnToTelegram(
    cfg.botToken,
    allowedChatId,
    d.rootId,
    d.rootPath,
    d.topicId,
    text,
    attachments,
  );
}

async function downloadTelegramPhoto(
  token: string,
  fileId: string,
  rootPath: string,
): Promise<Attachment | null> {
  const meta = await tgCall(token, "getFile", { file_id: fileId });
  const filePath = (meta as { result?: { file_path?: string } }).result
    ?.file_path;
  if (!meta.ok || !filePath) return null;
  const res = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = path.join(rootPath, ".reflex", "attachments");
  await fs.mkdir(dir, { recursive: true });
  const name = `tg-${Date.now().toString(36)}-${path.basename(filePath)}`;
  const abs = path.join(dir, name);
  await fs.writeFile(abs, bytes);
  return {
    name,
    absPath: abs,
    size: bytes.length,
    mime: filePath.endsWith(".png") ? "image/png" : "image/jpeg",
  };
}

const EDIT_THROTTLE_MS = 1500;

/**
 * Run a turn and stream the assistant text into Telegram by editing a
 * single placeholder message as the reply grows — Telegram's stand-in
 * for token streaming. Throttled to one edit per ~1.5s (API limits), and
 * only when the text actually changed. On completion the message is
 * finalized; overflow past Telegram's 4k cap spills into extra messages.
 */
async function streamTurnToTelegram(
  token: string,
  chatId: string,
  rootId: string,
  rootPath: string,
  topicId: string,
  message: string,
  attachments: Attachment[] = [],
): Promise<void> {
  const before = (await readEvents(rootPath, topicId)).length;
  const res = await startOrchestratorTurn({ rootId, topicId, message, attachments });
  if ("error" in res) {
    await sendMessage(token, chatId, `⚠️ ${res.error}`);
    return;
  }

  const messageId = await sendPlain(token, chatId, "💭…");
  const collect = async (): Promise<string> => {
    const events = await readEvents(rootPath, topicId);
    const text = events
      .slice(before)
      .filter(
        (e): e is Extract<(typeof events)[number], { type: "assistant-delta" }> =>
          e.type === "assistant-delta",
      )
      .map((e) => e.text)
      .join("");
    return stripMarkers(text);
  };

  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let lastShown = "";
  let lastEditAt = 0;
  await sleep(400);
  while (Date.now() < deadline) {
    const active = agentManager.isActive(topicId);
    const cur = await collect();
    const head = cur.slice(0, TG_MAX);
    if (
      messageId &&
      head &&
      head !== lastShown &&
      Date.now() - lastEditAt >= EDIT_THROTTLE_MS
    ) {
      await editPlain(token, chatId, messageId, head);
      lastShown = head;
      lastEditAt = Date.now();
    }
    if (!active) break;
    await sleep(600);
  }
  await sleep(400); // flush trailing deltas

  const finalText = (await collect()) || "(no reply)";
  const head = finalText.slice(0, TG_MAX);
  if (messageId) {
    if (head !== lastShown) await editPlain(token, chatId, messageId, head);
  } else {
    await sendMessage(token, chatId, head);
  }
  // Overflow beyond the 4k cap → continuation messages.
  for (let i = TG_MAX; i < finalText.length; i += TG_MAX) {
    await sendMessage(token, chatId, finalText.slice(i, i + TG_MAX));
  }
}

function stripMarkers(text: string): string {
  return text
    .replace(/<{1,2}reflex:[a-z-]+>{1,2}[\s\S]*?<{1,2}\/reflex:[a-z-]+>{1,2}/g, "")
    // Drop a trailing, not-yet-closed marker so half-streamed JSON doesn't flash.
    .replace(/<{1,2}reflex:[a-z-]+>{1,2}[\s\S]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// State (poll offset + persistent topic id)

interface TgState {
  offset?: number;
  topicId?: string;
  rootId?: string;
}

async function readState(): Promise<TgState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as TgState;
  } catch {
    return {};
  }
}

async function writeState(state: TgState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function readOffset(): Promise<number> {
  return (await readState()).offset ?? 0;
}

async function writeOffset(offset: number): Promise<void> {
  const state = await readState();
  await writeState({ ...state, offset });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
