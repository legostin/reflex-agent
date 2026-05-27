import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Settings,
} from "./schema";

const SETTINGS_DIR = path.join(os.homedir(), ".reflex");
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
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(
    SETTINGS_FILE,
    JSON.stringify(validated, null, 2) + "\n",
    "utf8",
  );
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
