// Sets REFLEX_HOME for the prod CLI before any module reads it.
//
// ESM evaluates imports in DFS post-order, so importing this file first
// from `bin/cli.ts` guarantees the env var is set before sibling imports
// (registry, settings, etc.) read it at their module-load time.
//
// Dev (`pnpm dev` → Next directly) doesn't go through bin/, so it keeps
// the `~/.reflex` default from `reflexHome()`.
import os from "node:os";
import path from "node:path";

if (!process.env.REFLEX_HOME) {
  process.env.REFLEX_HOME = path.join(os.homedir(), ".reflex-agent");
}
