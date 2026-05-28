import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexHome } from "@/lib/reflex/home";
import { loadSettings } from "@/lib/settings/store";
import { startOrchestratorTurn } from "@/lib/server/agents/start-turn";
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

async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(api(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Retry once without Markdown — a stray `*`/`_` can 400 the parse.
    await fetch(api(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  }
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
        offset = u.update_id + 1;
        await writeOffset(offset);
        await handleUpdate(cfg, u).catch((err) => {
          console.error(
            "[telegram] handleUpdate:",
            err instanceof Error ? err.message : err,
          );
        });
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
  const text = u.message?.text?.trim();
  const chatId = u.message?.chat?.id;
  if (!text || chatId === undefined) return;
  // Only accept messages from the configured chat.
  if (String(chatId) !== String(cfg.chatId)) return;

  // Telegram and the web home page are the SAME conversation — both talk
  // to the central dispatcher thread in the synthetic home Space.
  const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
  const d = await getDispatcherTopic();
  const reply = await runTurnAndAwaitReply(d.rootId, d.rootPath, d.topicId, text);
  await sendMessage(cfg.botToken, cfg.chatId, reply || "(no reply)");
}

/**
 * Start a turn on the persistent topic and wait for it to finish, then
 * return the assistant text produced THIS turn (markers stripped). Same
 * poll-until-idle pattern as runHeadlessAgent, but against a persistent
 * topic so we keep continuity.
 */
async function runTurnAndAwaitReply(
  rootId: string,
  rootPath: string,
  topicId: string,
  message: string,
): Promise<string> {
  const before = (await readEvents(rootPath, topicId)).length;
  const res = await startOrchestratorTurn({ rootId, topicId, message, attachments: [] });
  if ("error" in res) return `⚠️ ${res.error}`;
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  await sleep(400);
  while (Date.now() < deadline) {
    if (!agentManager.isActive(topicId)) break;
    await sleep(500);
  }
  await sleep(400); // flush window for trailing deltas
  const events = await readEvents(rootPath, topicId);
  const fresh = events.slice(before);
  const text = fresh
    .filter(
      (e): e is Extract<(typeof fresh)[number], { type: "assistant-delta" }> =>
        e.type === "assistant-delta",
    )
    .map((e) => e.text)
    .join("")
    .trim();
  return stripMarkers(text);
}

function stripMarkers(text: string): string {
  return text
    .replace(/<{1,2}reflex:[a-z-]+>{1,2}[\s\S]*?<{1,2}\/reflex:[a-z-]+>{1,2}/g, "")
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
