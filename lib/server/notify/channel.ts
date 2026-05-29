import "server-only";
import type { Settings } from "@/lib/settings";
import type { NotifyPayload } from "./index";

/**
 * Outbound channel adapter. A channel is anything that can deliver a
 * notification payload to the user — Telegram today, Slack / web-push later.
 * `notify()` and the dispatcher mirror fan out over `channels()`; adding a new
 * channel is a new entry here, no caller changes.
 *
 * Rich, channel-specific interactivity (Telegram's live turn streaming, inline
 * keyboards, force-reply secrets) is NOT part of this interface — it stays in
 * the Telegram bridge as that adapter's own capability. This contract is just
 * the lowest common denominator every channel must support: send a message.
 */
export interface Channel {
  id: string;
  /** Configured + enabled in settings? */
  isEnabled(settings: Settings): boolean;
  /** Deliver one notification. Throws on failure (caller records per-channel). */
  send(settings: Settings, payload: NotifyPayload): Promise<void>;
}

const telegram: Channel = {
  id: "telegram",
  isEnabled: (s) => {
    const tg = s.notify?.telegram;
    return !!(tg?.enabled && tg.botToken && tg.chatId);
  },
  send: async (s, payload) => {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(s.notify.telegram, payload);
  },
};

/**
 * The registered outbound channels. A future Slack adapter slots in here
 * (its own `isEnabled` reading `settings.notify.slack`, its own `send`).
 */
export function channels(): Channel[] {
  return [telegram];
}
