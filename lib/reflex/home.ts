import os from "node:os";
import path from "node:path";

/**
 * Resolve the directory where Reflex stores global state (registry, settings,
 * MCP config, API keys, skills, etc.). Honors `$REFLEX_HOME` so prod and dev
 * installs can be isolated.
 *
 * Defaults:
 * - `pnpm dev` (source build) → `~/.reflex`
 * - `reflex start` (npm-installed CLI) → `~/.reflex-agent` (set by bin/cli.ts)
 */
export function reflexHome(): string {
  const fromEnv = process.env.REFLEX_HOME;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".reflex");
}
