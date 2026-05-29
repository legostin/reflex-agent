import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from "./schema";
import { reflexHome } from "../reflex/home.js";
import { writeJsonFile } from "../reflex/store/json-store.js";

const SETTINGS_DIR = reflexHome();
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SETTINGS;
    return parsed.data;
  } catch (err: unknown) {
    if (isNotFound(err)) return DEFAULT_SETTINGS;
    throw err;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const validated = SettingsSchema.parse(settings);
  // Atomic + 0o600 — settings.json holds the Telegram bot token, so it must
  // never be left half-written and must not be world-readable.
  await writeJsonFile(SETTINGS_FILE, validated, { mode: 0o600 });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
