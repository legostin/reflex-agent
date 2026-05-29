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
import { readWidget } from "@/lib/server/widgets/store";
import {
  renderWidget,
  type RenderedWidget,
  type WidgetActionRef,
} from "./widget-render";
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
  if (payload.title) parts.push(`**${payload.title}**`);
  parts.push(payload.body);
  if (payload.link) parts.push(payload.link);
  await sendFormatted(cfg.botToken, cfg.chatId, parts.join("\n\n"));
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

interface InlineButton {
  text: string;
  data: string;
}

/** Send a plain message with an inline keyboard (rows of buttons). */
async function sendKeyboard(
  token: string,
  chatId: string,
  text: string,
  rows: InlineButton[][],
): Promise<number | null> {
  const r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, TG_MAX),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: rows.map((row) =>
        row.map((b) => ({ text: b.text, callback_data: b.data })),
      ),
    },
  });
  return r.ok && r.result?.message_id ? r.result.message_id : null;
}

const TG_CALLBACK_MAX = 64; // Telegram's callback_data byte limit.

/**
 * Inline keyboard for a rendered widget's actions. callback_data is
 * `w:<widgetId>:<idx>` — self-contained so taps survive a restart (the
 * widget + action are re-read from disk at tap time). Buttons whose data
 * would exceed 64 bytes are dropped (the item still shows as text).
 */
function widgetKeyboard(
  widgetId: string,
  actions: WidgetActionRef[],
): InlineButton[][] {
  const rows: InlineButton[][] = [];
  actions.forEach((a, idx) => {
    const data = `w:${widgetId}:${idx}`;
    if (Buffer.byteLength(data, "utf8") > TG_CALLBACK_MAX) return;
    rows.push([{ text: a.label.slice(0, 60), data }]);
  });
  return rows;
}

function keyboardMarkup(rows: InlineButton[][]) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data })),
    ),
  };
}

/** Send a widget as an HTML message with optional action buttons. */
async function sendWidget(
  token: string,
  chatId: string,
  widgetId: string,
  rendered: RenderedWidget,
): Promise<number | null> {
  const rows = rendered.utility
    ? widgetKeyboard(widgetId, rendered.actions)
    : [];
  const body = rendered.text.slice(0, TG_MAX);
  const base: Record<string, unknown> = {
    chat_id: chatId,
    disable_web_page_preview: true,
    ...(rows.length ? { reply_markup: keyboardMarkup(rows) } : {}),
  };
  let r = await tgCall(token, "sendMessage", {
    ...base,
    text: mdToTelegramHtml(body),
    parse_mode: "HTML",
  });
  if (!r.ok) {
    r = await tgCall(token, "sendMessage", { ...base, text: body });
  }
  return r.ok && r.result?.message_id ? r.result.message_id : null;
}

/** Re-render a widget message in place after an action ran. */
async function editWidget(
  token: string,
  chatId: string,
  messageId: number,
  widgetId: string,
  rendered: RenderedWidget,
): Promise<void> {
  const rows = rendered.utility
    ? widgetKeyboard(widgetId, rendered.actions)
    : [];
  const body = rendered.text.slice(0, TG_MAX);
  const base: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    disable_web_page_preview: true,
    ...(rows.length ? { reply_markup: keyboardMarkup(rows) } : {}),
  };
  const r = await tgCall(token, "editMessageText", {
    ...base,
    text: mdToTelegramHtml(body),
    parse_mode: "HTML",
  });
  if (!r.ok) {
    await tgCall(token, "editMessageText", { ...base, text: body });
  }
}

/** Replace a message's text and drop its keyboard (post-answer). */
async function resolveKeyboardMessage(
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

/** Prompt the user to reply (force_reply) — used for open answers / secrets. */
async function forceReply(
  token: string,
  chatId: string,
  text: string,
): Promise<number | null> {
  const r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, TG_MAX),
    reply_markup: { force_reply: true },
  });
  return r.ok && r.result?.message_id ? r.result.message_id : null;
}

async function answerCallback(token: string, callbackId: string): Promise<void> {
  await tgCall(token, "answerCallbackQuery", { callback_query_id: callbackId });
}

async function deleteMessage(
  token: string,
  chatId: string,
  messageId: number,
): Promise<void> {
  await tgCall(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

// ---------------------------------------------------------------------------
// Markdown → Telegram HTML. The agent writes GitHub-flavored markdown
// (**bold**, `code`, ```blocks```, [links](url), tables). Telegram has no
// tables and a fiddly markdown dialect, so we render to HTML (only b/i/
// code/pre/a + escaped &<>) and fall back to plain text if Telegram
// rejects the parse (e.g. a half-streamed, unbalanced chunk).

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToTelegramHtml(src: string): string {
  const blocks: string[] = [];
  let s = src.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(code.replace(/\n+$/, ""));
    return ` B${blocks.length - 1} `;
  });
  const inline: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    inline.push(c);
    return ` I${inline.length - 1} `;
  });
  s = escHtml(s);
  s = convertTables(s);
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:]|$)/g, "$1<i>$2</i>");
  s = s.replace(/ I(\d+) /g, (_m, i: string) => `<code>${escHtml(inline[+i] ?? "")}</code>`);
  s = s.replace(/ B(\d+) /g, (_m, i: string) => `<pre>${escHtml(blocks[+i] ?? "")}</pre>`);
  return s;
}

/** GFM tables → readable text: bold header, "cell — cell" rows, no pipes. */
function convertTables(s: string): string {
  const lines = s.split("\n");
  const out: string[] = [];
  let i = 0;
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const cells = (l: string) =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    if (isRow(lines[i]!) && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      out.push("<b>" + cells(lines[i]!).join(" — ") + "</b>");
      i += 2;
      while (i < lines.length && isRow(lines[i]!) && !isSep(lines[i]!)) {
        out.push("• " + cells(lines[i]!).join(" — "));
        i++;
      }
    } else {
      out.push(lines[i]!);
      i++;
    }
  }
  return out.join("\n");
}

/** Send agent content rendered as Telegram HTML; falls back to plain. */
async function sendFormatted(
  token: string,
  chatId: string,
  md: string,
): Promise<number | null> {
  const body = md.slice(0, TG_MAX);
  let r = await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: mdToTelegramHtml(body),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!r.ok) {
    r = await tgCall(token, "sendMessage", {
      chat_id: chatId,
      text: body,
      disable_web_page_preview: true,
    });
  }
  return r.ok && r.result?.message_id ? r.result.message_id : null;
}

/** Edit a message with HTML-rendered content; falls back to plain. */
async function editFormatted(
  token: string,
  chatId: string,
  messageId: number,
  md: string,
): Promise<void> {
  const body = md.slice(0, TG_MAX);
  const r = await tgCall(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: mdToTelegramHtml(body),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!r.ok) {
    await tgCall(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: body,
      disable_web_page_preview: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Interactive state (in-memory)

// Per-topic serialized turn queue — keeps the poll loop non-blocking so a
// callback_query (button tap) can be received WHILE a turn streams.
const topicQueues = new Map<string, Promise<void>>();

function enqueueTurn(topicId: string, fn: () => Promise<void>): void {
  const prev = topicQueues.get(topicId) ?? Promise.resolve();
  const next = prev
    .then(fn)
    .catch((err) =>
      console.error(
        "[telegram] turn:",
        err instanceof Error ? err.message : err,
      ),
    );
  topicQueues.set(topicId, next);
}

// One streaming watcher per topic — tracks which interactions it already
// surfaced so it doesn't re-send a keyboard for the same request.
interface Watcher {
  /** Interactions surfaced during THIS turn (dedup within the turn). */
  presented: Set<string>;
  /** Interactions already open when the turn started — a question/
   *  permission the user typed past. Never re-presented, and never
   *  treated as "awaiting" (so they don't hold the turn loop open). */
  seeded: Set<string>;
}
const watchers = new Map<string, Watcher>();

// callback_data (≤64 bytes) is SELF-CONTAINED — `kind:requestId:suffix`
// — so taps survive a server restart that would wipe an in-memory map.
// requestIds are short (12 hex). The agent + topic are always the
// dispatcher's, resolved at tap time.
function parseCallback(
  data: string,
): { kind: string; requestId: string; suffix: string } | null {
  const parts = data.split(":");
  if (parts.length < 3) return null;
  return {
    kind: parts[0]!,
    suffix: parts[parts.length - 1]!,
    requestId: parts.slice(1, -1).join(":"),
  };
}

// Awaiting a force_reply (open answer or a secret value), keyed by chatId.
interface PendingReply {
  agentId: string;
  topicId: string;
  rootPath: string;
  chatId: string;
  kind: "answer" | "secret";
  requestId: string;
  /** secret: env key currently being collected. */
  secretKey?: string;
  /** secret: remaining keys to collect after this one. */
  remaining?: string[];
  /** secret: values gathered so far. */
  collected?: Record<string, string>;
  /** message_id of the prompt, deleted with the reply for secrets. */
  promptMsgId?: number;
}
const pendingReplies = new Map<string, PendingReply>();

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
  let caughtUp = false;
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
    // Once on boot: flush any answer a dead watcher never delivered.
    if (!caughtUp) {
      caughtUp = true;
      await catchUpDispatcher(cfg);
    }
    try {
      const updates = await getUpdates(cfg.botToken, offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        await writeOffset(offset);
        // Dispatch WITHOUT awaiting — turns run on a per-topic queue,
        // callbacks resolve inline. The poll loop must stay free to fetch
        // the next callback_query while a turn is still streaming.
        dispatchUpdate(cfg, u);
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

interface TgMessage {
  message_id?: number;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  chat?: { id: number };
  reply_to_message?: { message_id?: number };
}

interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: { chat?: { id: number }; message_id?: number };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

function dispatchUpdate(cfg: TelegramConfig, u: TgUpdate): void {
  if (u.callback_query) {
    void handleCallback(cfg, u.callback_query).catch((err) =>
      console.error(
        "[telegram] callback:",
        err instanceof Error ? err.message : err,
      ),
    );
    return;
  }
  if (u.message?.chat) {
    void handleMessage(cfg, u.message).catch((err) =>
      console.error(
        "[telegram] message:",
        err instanceof Error ? err.message : err,
      ),
    );
  }
}

async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  const url = `${api(token, "getUpdates")}?timeout=${POLL_TIMEOUT_S}&offset=${offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000),
  });
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`);
  const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
  return body.result ?? [];
}

async function handleMessage(cfg: TelegramConfig, msg: TgMessage): Promise<void> {
  const chatId = msg.chat?.id;
  if (chatId === undefined) return;
  const photos = msg.photo ?? [];
  let text = (msg.text ?? msg.caption ?? "").trim();
  const typedText = text; // what the user actually typed, before any default

  let allowedChatId = cfg.chatId;
  // First-message auto-bind (unchanged): connect on first text.
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
      /* best-effort */
    }
    await sendMessage(
      cfg.botToken,
      allowedChatId,
      "Connected ✅ — I'll answer here from now on.",
    );
  }
  if (String(chatId) !== String(allowedChatId)) return;

  // If we're waiting on a force_reply (open answer / secret), this message
  // is that reply — route it instead of starting a new turn.
  const waiting = pendingReplies.get(allowedChatId);
  if (waiting && text) {
    await handleReplyInput(cfg, allowedChatId, waiting, text, msg.message_id);
    return;
  }

  if (!text && photos.length === 0) return;
  if (!text && photos.length > 0) text = "What's in this image?";

  const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
  const d = await getDispatcherTopic();

  // The agent is blocked on a permission request and the user typed instead of
  // tapping: per their choice, a typed reply IS a refusal — deny the pending
  // request(s), forwarding the text to the agent as guidance, and do NOT start
  // a new turn (the agent resumes from the deny).
  if (typedText) {
    const blockedAgent = agentIdForTopic(d.topicId);
    if (blockedAgent && agentManager.hasPendingPermission(blockedAgent)) {
      const n = await agentManager.denyPendingPermissions(blockedAgent, typedText);
      await sendPlain(
        cfg.botToken,
        allowedChatId,
        n > 1
          ? `❌ Denied ${n} requests — passed your note to the agent.`
          : "❌ Denied — passed your note to the agent.",
      );
      return;
    }
  }

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

  // Serialize per topic so two messages don't spawn two streamers.
  enqueueTurn(d.topicId, () =>
    runTurn(
      cfg.botToken,
      allowedChatId,
      d.rootId,
      d.rootPath,
      d.topicId,
      text,
      attachments,
    ),
  );
}

/** A tapped inline button — resolve the matching interaction. */
async function handleCallback(
  cfg: TelegramConfig,
  cq: TgCallbackQuery,
): Promise<void> {
  await answerCallback(cfg.botToken, cq.id);
  const chatId = cq.message?.chat?.id;
  const msgId = cq.message?.message_id;
  const parsed = cq.data ? parseCallback(cq.data) : null;
  if (!parsed || chatId === undefined) return;
  const chat = String(chatId);

  const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
  const d = await getDispatcherTopic();

  // Widget action taps are independent of a running agent — handle them
  // before the agentId gate (which guards the p/q/m interaction taps).
  if (parsed.kind === "w") {
    await handleWidgetCallback(cfg, chat, msgId, parsed.requestId, parsed.suffix, d);
    return;
  }

  const agentId = agentIdForTopic(d.topicId);
  if (!agentId) {
    if (msgId) {
      await resolveKeyboardMessage(
        cfg.botToken,
        chat,
        msgId,
        "↻ That turn already ended — send your message again.",
      );
    }
    return;
  }

  const { kind, requestId, suffix } = parsed;
  try {
    if (kind === "p") {
      const decision = suffix === "deny" ? "deny" : "allow";
      const scope = suffix === "always" ? "always" : suffix === "once" ? "once" : undefined;
      // Recover the tool name from the originating request — for the persist
      // path and so the resolved label says WHAT was approved.
      let tool: string | undefined;
      try {
        const events = await readEvents(d.rootPath, d.topicId);
        const req = events.find(
          (e): e is Extract<(typeof events)[number], { type: "permission-request" }> =>
            e.type === "permission-request" && e.requestId === requestId,
        );
        tool = req?.tool;
      } catch {
        /* ignore — label just omits the tool */
      }
      await agentManager.resolveInteractive("permission", requestId, {
        decision,
        ...(scope ? { scope } : {}),
        ...(tool ? { tool } : {}),
      }, agentId);
      if (msgId) {
        const what = tool ? `\`${tool}\` ` : "";
        const label =
          decision === "deny"
            ? `❌ ${what}denied`
            : scope === "always"
              ? `✅ ${what}allowed (always)`
              : `✅ ${what}allowed once`;
        await resolveKeyboardMessage(cfg.botToken, chat, msgId, label);
      }
    } else if (kind === "q") {
      // suffix is the choice index — resolve to the label from the event.
      const events = await readEvents(d.rootPath, d.topicId);
      const q = events.find(
        (e): e is Extract<typeof events[number], { type: "question" }> =>
          e.type === "question" && e.questionId === requestId,
      );
      const labels = (q?.options?.map((o) => o.label) ?? q?.choices ?? []).filter(
        Boolean,
      );
      const answer = labels[Number(suffix)] ?? "";
      await agentManager.resolveInteractive("question", requestId, { answer }, agentId);
      if (msgId) {
        await resolveKeyboardMessage(cfg.botToken, chat, msgId, `✅ ${answer}`);
      }
    } else if (kind === "m") {
      if (suffix === "reject") {
        await agentManager.resolveInteractive("mcp-add", requestId, { decision: "reject" }, agentId);
        if (msgId) {
          await resolveKeyboardMessage(cfg.botToken, chat, msgId, "❌ Skipped");
        }
      } else {
        if (msgId) {
          await resolveKeyboardMessage(cfg.botToken, chat, msgId, "🔐 Connecting…");
        }
        await beginSecretCollection(cfg, {
          agentId,
          topicId: d.topicId,
          rootPath: d.rootPath,
          chatId: chat,
          requestId,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msgId) {
      await resolveKeyboardMessage(
        cfg.botToken,
        chat,
        msgId,
        /not found/i.test(msg)
          ? "↻ That turn already ended — send your message again."
          : `⚠️ ${msg}`,
      );
    }
  }
}

/** A tapped widget action button → invoke the utility action + redraw. */
async function handleWidgetCallback(
  cfg: TelegramConfig,
  chat: string,
  msgId: number | undefined,
  widgetId: string,
  idxStr: string,
  d: { rootId: string; rootPath: string; topicId: string },
): Promise<void> {
  const record = await readWidget(d.rootPath, widgetId);
  if (!record) {
    if (msgId) {
      await resolveKeyboardMessage(
        cfg.botToken,
        chat,
        msgId,
        "↻ That widget no longer exists.",
      );
    }
    return;
  }
  const rendered = renderWidget(record);
  const action = rendered.actions[Number(idxStr)];
  if (!rendered.utility || !action) return; // not actionable / stale index

  try {
    const { invokeCardActionAction } = await import(
      "@/lib/server/widgets/actions"
    );
    const res = await invokeCardActionAction(d.rootId, {
      utilityId: rendered.utility.id,
      utilityScope: rendered.utility.scope,
      widgetId,
      actionName: action.actionName,
      args: { id: action.itemId, ...(action.args ?? {}) },
    });
    if (!res.ok) {
      if (msgId) {
        await resolveKeyboardMessage(
          cfg.botToken,
          chat,
          msgId,
          `⚠️ ${res.error ?? "Action failed"}`,
        );
      }
      return;
    }
    // invokeCardActionAction refreshed + persisted the card — redraw it.
    const fresh = await readWidget(d.rootPath, widgetId);
    if (fresh && msgId) {
      await editWidget(cfg.botToken, chat, msgId, widgetId, renderWidget(fresh));
    }
  } catch (err) {
    if (msgId) {
      await resolveKeyboardMessage(
        cfg.botToken,
        chat,
        msgId,
        `⚠️ ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Route a force_reply: an open question answer or a secret value. */
async function handleReplyInput(
  cfg: TelegramConfig,
  chatId: string,
  waiting: PendingReply,
  text: string,
  replyMsgId?: number,
): Promise<void> {
  pendingReplies.delete(chatId);
  if (waiting.kind === "answer") {
    await agentManager
      .resolveInteractive("question", waiting.requestId, { answer: text }, waiting.agentId)
      .catch((err) => console.error("[telegram] respondQuestion:", err));
    return;
  }

  // Secret value — record it, then scrub both the value and the prompt
  // from the chat so the secret doesn't linger in Telegram.
  const collected = { ...(waiting.collected ?? {}) };
  if (waiting.secretKey) collected[waiting.secretKey] = text;
  if (replyMsgId) await deleteMessage(cfg.botToken, chatId, replyMsgId);
  if (waiting.promptMsgId)
    await deleteMessage(cfg.botToken, chatId, waiting.promptMsgId);

  const remaining = waiting.remaining ?? [];
  if (remaining.length > 0) {
    const [next, ...rest] = remaining;
    const promptMsgId = await forceReply(
      cfg.botToken,
      chatId,
      `Paste value for \`${next}\``,
    );
    pendingReplies.set(chatId, {
      ...waiting,
      secretKey: next,
      remaining: rest,
      collected,
      ...(promptMsgId ? { promptMsgId } : { promptMsgId: undefined }),
    });
    return;
  }

  // All collected → approve the mcp-add with the secret values.
  await agentManager
    .resolveInteractive(
      "mcp-add",
      waiting.requestId,
      { decision: "approve", secretValues: collected },
      waiting.agentId,
    )
    .catch((err) => console.error("[telegram] respondMcpAdd:", err));
  await sendMessage(cfg.botToken, chatId, "✅ Connected.");
}

/**
 * Begin (or skip) secret collection for an approved mcp-add. Reads the
 * request's declared secret slots; prompts the first via force_reply, or
 * connects immediately when none are required.
 */
async function beginSecretCollection(
  cfg: TelegramConfig,
  entry: {
    agentId: string;
    topicId: string;
    rootPath: string;
    chatId: string;
    requestId: string;
  },
): Promise<void> {
  const events = await readEvents(entry.rootPath, entry.topicId);
  const req = events.find(
    (e): e is Extract<typeof events[number], { type: "mcp-add-request" }> =>
      e.type === "mcp-add-request" && e.requestId === entry.requestId,
  );
  const keys = (req?.secrets ?? [])
    .filter((s) => s.required !== false)
    .map((s) => s.envKey);
  if (keys.length === 0) {
    await agentManager
      .resolveInteractive(
        "mcp-add",
        entry.requestId,
        { decision: "approve", secretValues: {} },
        entry.agentId,
      )
      .catch((err) => console.error("[telegram] respondMcpAdd:", err));
    await sendMessage(cfg.botToken, entry.chatId, "✅ Connected.");
    return;
  }
  const [first, ...rest] = keys;
  const promptMsgId = await forceReply(
    cfg.botToken,
    entry.chatId,
    `Paste value for \`${first}\` (it'll be deleted from the chat right after).`,
  );
  pendingReplies.set(entry.chatId, {
    agentId: entry.agentId,
    topicId: entry.topicId,
    rootPath: entry.rootPath,
    chatId: entry.chatId,
    kind: "secret",
    requestId: entry.requestId,
    secretKey: first,
    remaining: rest,
    collected: {},
    ...(promptMsgId ? { promptMsgId } : {}),
  });
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
// Generous cap — a turn that pauses on a permission/question waits here
// for the user's tap. Normal turns break as soon as the agent idles.
const INTERACTIVE_TIMEOUT_MS = 15 * 60_000;

/**
 * Run a turn and stream it into Telegram. Edits a placeholder message as
 * the assistant text grows (Telegram's stand-in for token streaming) AND
 * surfaces any interaction the agent raises (question / permission /
 * mcp-add) as inline keyboards — so the turn can pause for the user and
 * resume after a tap, all in one thread. One runTurn per topic at a time
 * (serialized by the topic queue).
 */
async function runTurn(
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

  // Interactions ALREADY open before this turn (a question/permission the
  // user typed past instead of tapping). They must NOT be re-presented and
  // must NOT keep the turn loop alive — otherwise `openInteractions`, which
  // scans the whole log, would re-surface them on every message and the
  // loop would never break (each turn starts a fresh watcher).
  const seeded = new Set<string>();
  for (const it of openInteractions(
    (await readEvents(rootPath, topicId)).slice(0, before),
  )) {
    seeded.add(it.requestId);
  }
  const watcher: Watcher = { presented: new Set(), seeded };
  watchers.set(topicId, watcher);
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

  const deadline = Date.now() + INTERACTIVE_TIMEOUT_MS;
  let lastShown = "";
  let lastEditAt = 0;
  await sleep(400);
  try {
    while (Date.now() < deadline) {
      const cur = await collect();
      const head = cur.slice(0, TG_MAX);
      if (
        messageId &&
        head &&
        head !== lastShown &&
        Date.now() - lastEditAt >= EDIT_THROTTLE_MS
      ) {
        await editFormatted(token, chatId, messageId, head);
        lastShown = head;
        lastEditAt = Date.now();
        // The whole answer-so-far is now on screen. Advance the delivery
        // cursor so a restart mid-turn doesn't re-send it via boot
        // catch-up. (Only when not truncated — overflow is sent at
        // finalize, so leave the cursor until then if cur exceeds TG_MAX.)
        if (head === cur) {
          await setDeliveredCount((await readEvents(rootPath, topicId)).length);
        }
      }
      const open = await presentInteractions(
        token,
        chatId,
        rootPath,
        topicId,
        watcher,
      );
      const active = agentManager.isActive(topicId);
      // Keep watching while the agent runs OR an interaction is still
      // waiting for the user. Otherwise the turn is done.
      if (!active && !open) break;
      // Wake immediately on new agent output; otherwise re-check in ≤700ms.
      await waitForTopicEventOr(topicId, 700);
    }
    await sleep(300); // flush trailing deltas

    const finalText = await collect();
    const head = finalText.slice(0, TG_MAX);
    if (messageId) {
      if (head) {
        await editFormatted(token, chatId, messageId, head);
      } else {
        // No assistant prose (e.g. the turn was only an interaction) —
        // drop the placeholder so it isn't left as "💭…".
        await deleteMessage(token, chatId, messageId);
      }
    } else if (head) {
      await sendFormatted(token, chatId, head);
    }
    for (let i = TG_MAX; i < finalText.length; i += TG_MAX) {
      await sendFormatted(token, chatId, finalText.slice(i, i + TG_MAX));
    }
    // Surface any widget the dispatcher created/updated this turn as its
    // own message (text + tappable action buttons for utility cards).
    await presentWidgets(token, chatId, rootPath, topicId, before);
    // Advance the delivery cursor so the boot catch-up doesn't re-send
    // what this live watcher just delivered. runTurn only ever runs for
    // the dispatcher topic, which is the only topic catch-up tracks.
    await setDeliveredCount((await readEvents(rootPath, topicId)).length);
  } finally {
    watchers.delete(topicId);
  }
}

/**
 * Render every widget the dispatcher created or updated since
 * `sinceIndex` into the chat. Deduped by id (a create+update in one turn
 * shows once, with the final on-disk state). Utility-card action lists
 * get tappable buttons; everything else is text.
 */
async function presentWidgets(
  token: string,
  chatId: string,
  rootPath: string,
  topicId: string,
  sinceIndex: number,
): Promise<void> {
  const events = await readEvents(rootPath, topicId);
  const ids: string[] = [];
  for (const e of events.slice(sinceIndex)) {
    if (
      e.type === "widget-event" &&
      (e.op === "create" || e.op === "update") &&
      !ids.includes(e.widgetId)
    ) {
      ids.push(e.widgetId);
    }
  }
  for (const id of ids) {
    try {
      const record = await readWidget(rootPath, id);
      if (!record) continue;
      const rendered = renderWidget(record);
      if (!rendered.text.trim()) continue;
      await sendWidget(token, chatId, id, rendered);
    } catch (err) {
      console.error(
        "[telegram] presentWidgets:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

interface OpenInteraction {
  kind: "permission" | "question" | "mcp-add";
  requestId: string;
  tool?: string;
  description?: string;
  prompt?: string;
  choices?: string[];
  options?: Array<{ label: string }>;
  label?: string;
  secrets?: Array<{ envKey: string; label: string; required?: boolean }>;
}

/**
 * Surface any not-yet-presented open interaction as a keyboard / prompt.
 * Returns true if there's an interaction THIS turn raised that's still
 * awaiting the user (so the turn loop keeps waiting). Interactions that
 * were already open when the turn started (`watcher.seeded`) are ignored
 * entirely — neither re-presented nor counted as awaiting.
 */
async function presentInteractions(
  token: string,
  chatId: string,
  rootPath: string,
  topicId: string,
  watcher: Watcher,
): Promise<boolean> {
  const open = openInteractions(await readEvents(rootPath, topicId)).filter(
    (it) => !watcher.seeded.has(it.requestId),
  );
  if (open.length === 0) return false;
  const agentId = agentIdForTopic(topicId);
  for (const it of open) {
    if (watcher.presented.has(it.requestId)) continue;
    watcher.presented.add(it.requestId);
    if (it.kind === "permission") {
      const rows: InlineButton[][] = [
        [
          { text: "✅ Allow once", data: `p:${it.requestId}:once` },
          { text: "✅ Always", data: `p:${it.requestId}:always` },
        ],
        [{ text: "❌ Deny", data: `p:${it.requestId}:deny` }],
      ];
      const title = it.tool ? `🔐 Allow \`${it.tool}\`?` : "🔐 Permission?";
      await sendKeyboard(
        token,
        chatId,
        it.description ? `${title}\n${it.description}` : title,
        rows,
      );
    } else if (it.kind === "question") {
      const labels = (it.options?.map((o) => o.label) ?? it.choices ?? []).filter(
        Boolean,
      );
      const head = `❓ ${it.prompt ?? "Question"}`;
      if (labels.length > 0) {
        const rows: InlineButton[][] = labels
          .slice(0, 8)
          .map((l, idx) => [
            { text: l.slice(0, 60), data: `q:${it.requestId}:${idx}` },
          ]);
        await sendKeyboard(token, chatId, head, rows);
      } else if (agentId) {
        const promptMsgId = await forceReply(token, chatId, head);
        pendingReplies.set(chatId, {
          agentId,
          topicId,
          rootPath,
          chatId,
          kind: "answer",
          requestId: it.requestId,
          ...(promptMsgId ? { promptMsgId } : {}),
        });
      }
    } else if (it.kind === "mcp-add") {
      const need = (it.secrets ?? []).filter((s) => s.required !== false);
      const rows: InlineButton[][] = [
        [
          {
            text: need.length > 0 ? "🔐 Enter secrets" : "✅ Connect",
            data: `m:${it.requestId}:approve`,
          },
        ],
        [{ text: "Skip", data: `m:${it.requestId}:reject` }],
      ];
      const slots = need.length
        ? `\nSecrets: ${need.map((s) => s.envKey).join(", ")}`
        : "";
      await sendKeyboard(
        token,
        chatId,
        `🔐 Connect ${it.label ?? "a service"}?${slots}`,
        rows,
      );
    }
  }
  return true;
}

/** Scan events for still-open interactions, with full payloads. */
function openInteractions(
  events: import("@/lib/server/agents/types").AgentEvent[],
): OpenInteraction[] {
  const open = new Map<string, OpenInteraction>();
  for (const e of events) {
    if (e.type === "permission-request") {
      open.set(`p:${e.requestId}`, {
        kind: "permission",
        requestId: e.requestId,
        ...(e.tool ? { tool: e.tool } : {}),
        ...(e.description ? { description: e.description } : {}),
      });
    } else if (e.type === "permission-response") {
      open.delete(`p:${e.requestId}`);
    } else if (e.type === "question") {
      open.set(`q:${e.questionId}`, {
        kind: "question",
        requestId: e.questionId,
        prompt: e.prompt,
        ...(e.choices ? { choices: e.choices } : {}),
        ...(e.options ? { options: e.options } : {}),
      });
    } else if (e.type === "answer") {
      open.delete(`q:${e.questionId}`);
    } else if (e.type === "mcp-add-request") {
      open.set(`m:${e.requestId}`, {
        kind: "mcp-add",
        requestId: e.requestId,
        label: e.label,
        ...(e.secrets ? { secrets: e.secrets } : {}),
      });
    } else if (e.type === "mcp-add-response") {
      open.delete(`m:${e.requestId}`);
    }
  }
  return [...open.values()];
}

/** The agent currently (or most recently) running this topic. */
function agentIdForTopic(topicId: string): string | null {
  const list = agentManager.list({ topicId });
  if (list.length === 0) return null;
  const running = list.find((a) => a.status === "running" || a.status === "starting");
  return (running ?? list[list.length - 1])?.id ?? null;
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
  /** events.jsonl length up to which the dispatcher topic's assistant
   *  output has already been delivered to Telegram. Lets the poller
   *  catch up answers a dead watcher (restart/crash) never pushed. */
  deliveredCount?: number;
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

async function setDeliveredCount(count: number): Promise<void> {
  const state = await readState();
  await writeState({ ...state, deliveredCount: count });
}

/**
 * Recover the tail of a Telegram turn whose live watcher died mid-delivery
 * (e.g. a server restart). Deliberately NARROW to avoid duplicates:
 *
 *  - Only fires when the delivery cursor sits INSIDE the last turn — i.e. a
 *    watcher had demonstrably started streaming this turn to Telegram and
 *    didn't finish. Web-chat turns (which never move the cursor) and old
 *    history are skipped, so we never mirror them or dump a backlog.
 *  - At-most-once: the cursor is advanced to the end BEFORE sending, so a
 *    crash mid-send can never re-dump the same content on the next boot.
 *  - Runs once on poller boot, and never while a turn is live.
 */
async function catchUpDispatcher(cfg: TelegramConfig): Promise<void> {
  if (!cfg.chatId) return;
  try {
    const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
    const d = await getDispatcherTopic();
    if (agentManager.isActive(d.topicId)) return; // a live turn owns delivery
    const events = await readEvents(d.rootPath, d.topicId);
    const state = await readState();

    // First boot: seed the cursor silently — never dump existing history.
    if (state.deliveredCount === undefined) {
      await setDeliveredCount(events.length);
      return;
    }
    const from = state.deliveredCount;
    // Advance the cursor up front (at-most-once delivery).
    await setDeliveredCount(events.length);

    // Index of the last turn-start. We only recover when the cursor is
    // strictly inside that turn (watcher was mid-delivery and died).
    let lastTurnStart = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === "turn-start") {
        lastTurnStart = i;
        break;
      }
    }
    if (from <= lastTurnStart || from >= events.length) return;

    const text = stripMarkers(
      events
        .slice(from)
        .filter(
          (e): e is Extract<(typeof events)[number], { type: "assistant-delta" }> =>
            e.type === "assistant-delta",
        )
        .map((e) => e.text)
        .join(""),
    );
    if (!text.trim()) return;
    for (let i = 0; i < text.length; i += TG_MAX) {
      await sendFormatted(cfg.botToken, cfg.chatId, text.slice(i, i + TG_MAX));
    }
  } catch (err) {
    console.error(
      "[telegram] catchUp:",
      err instanceof Error ? err.message : err,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve on the next event for `topicId`, or after `ms` — whichever first
 * (Phase 3: push, not poll). Lets the streaming watcher wake immediately on new
 * agent output instead of a blind fixed sleep, while keeping the timeout as the
 * reconciliation fallback (so interaction/widget scans still run on cadence
 * even if a subscription event is missed). Behavior-preserving: worst case it's
 * the old ≤`ms` poll.
 */
function waitForTopicEventOr(topicId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve();
    };
    const unsub = agentManager.subscribeTopic(topicId, () => finish());
    const timer = setTimeout(finish, ms);
  });
}
