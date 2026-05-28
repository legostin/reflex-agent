import "server-only";
import { loadSettings } from "@/lib/settings/store";

/**
 * Channel-agnostic notification layer. `notify()` fans a payload out to
 * every enabled channel. Telegram is the first adapter; web-push and
 * others slot in here without callers changing.
 *
 * Callers: the `<<reflex:notify>>` marker, the `notify` workflow step,
 * and (optionally) scheduler run outcomes.
 */

export interface NotifyPayload {
  /** Short heading (bolded by adapters that support it). */
  title?: string;
  /** Main text. Required. */
  body: string;
  /** Optional deep link back into Reflex. */
  link?: string;
  level?: "info" | "warn" | "error";
}

export interface NotifyResult {
  /** Channel ids that accepted the message. */
  delivered: string[];
  /** Per-channel errors, keyed by channel id. */
  errors: Record<string, string>;
}

export async function notify(payload: NotifyPayload): Promise<NotifyResult> {
  const delivered: string[] = [];
  const errors: Record<string, string> = {};
  if (!payload.body?.trim()) {
    return { delivered, errors: { _: "empty body" } };
  }

  const settings = await loadSettings();
  const tg = settings.notify?.telegram;
  if (tg?.enabled && tg.botToken && tg.chatId) {
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(tg, payload);
      delivered.push("telegram");
    } catch (err) {
      errors.telegram = err instanceof Error ? err.message : String(err);
    }
  }

  return { delivered, errors };
}
