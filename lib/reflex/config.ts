import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  configPath,
  DEFAULT_DEBOUNCE_MS,
  MIN_DEBOUNCE_MS,
  reflexRoot,
} from "./paths.js";

export const ConfigSchema = z.object({
  watchDebounceMs: z
    .number()
    .int()
    .min(MIN_DEBOUNCE_MS, {
      message: `watchDebounceMs must be ≥ ${MIN_DEBOUNCE_MS} ms`,
    })
    .default(DEFAULT_DEBOUNCE_MS),
  agentBackend: z.enum(["codex", "claude-code"]).default("claude-code"),
  ignoreFile: z.string().default(".reflexignore"),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

export async function loadConfig(root: string): Promise<Config> {
  const p = configPath(root);
  try {
    const raw = await fs.readFile(p, "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (isNotFound(err)) return DEFAULT_CONFIG;
    throw err;
  }
}

export async function writeConfig(root: string, cfg: Config): Promise<void> {
  await fs.mkdir(reflexRoot(root), { recursive: true });
  await fs.writeFile(
    configPath(root),
    JSON.stringify(cfg, null, 2) + "\n",
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

export function describeConfigPath(root: string): string {
  return path.relative(process.cwd(), configPath(root)) || configPath(root);
}
