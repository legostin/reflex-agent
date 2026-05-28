"use server";

import { revalidatePath } from "next/cache";
import { loadSettings, saveSettings } from "@/lib/settings/store";
import type { Settings } from "@/lib/settings/schema";

type TelegramSettings = Settings["notify"]["telegram"];

/**
 * Merge a partial Telegram config into settings.notify.telegram and
 * persist. Debounced auto-save from the settings panel (mirrors
 * patchNgrokSettingsAction).
 */
export async function patchTelegramSettingsAction(
  partial: Partial<TelegramSettings>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await loadSettings();
    const next: Settings = {
      ...settings,
      notify: {
        ...settings.notify,
        telegram: { ...settings.notify.telegram, ...partial },
      },
    };
    await saveSettings(next);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Send a test message to the configured chat so the user can verify the bot. */
export async function testTelegramAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const cfg = (await loadSettings()).notify.telegram;
    if (!cfg.botToken || !cfg.chatId) {
      return { ok: false, error: "Set bot token and chat id first." };
    }
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(cfg, {
      title: "Reflex",
      body: "Telegram is connected ✅ You'll get notifications here, and you can chat back.",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
