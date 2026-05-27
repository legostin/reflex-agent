import { promises as fs } from "node:fs";
import path from "node:path";
import { getRequestConfig } from "next-intl/server";
import { loadSettings } from "@/lib/settings/store";

export const SUPPORTED_LOCALES = ["en", "ru"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export default getRequestConfig(async () => {
  const settings = await loadSettings();
  const locale = normalizeLocale(settings.language);
  const messages = await loadMessages(locale);
  return { locale, messages };
});

/**
 * Load and merge every namespace file under `messages/<locale>/*.json` so each
 * page can own its own translation file without JSON-merge conflicts.
 */
async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const dir = path.resolve(process.cwd(), "messages", locale);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return {};
  }
  const merged: Record<string, unknown> = {};
  for (const file of files) {
    const namespace = file.replace(/\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      merged[namespace] = JSON.parse(raw);
    } catch {
      // Skip malformed files rather than crashing the whole render.
    }
  }
  return merged;
}

export function normalizeLocale(input: string | undefined | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const lower = input.toLowerCase();
  if (lower === "ru" || lower === "russian" || lower.startsWith("ru-")) {
    return "ru";
  }
  return "en";
}

/**
 * Human-readable language name for interpolation into agent prompts
 * ("write in {language}"). Distinct from the UI locale code.
 */
export function contentLanguageName(input: string | undefined | null): string {
  const locale = normalizeLocale(input);
  return locale === "ru" ? "Russian" : "English";
}
