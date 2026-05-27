// Sets env vars the prod CLI needs before any module reads them.
//
// ESM evaluates imports in DFS post-order, so importing this file first
// from `bin/cli.ts` guarantees these are set before sibling imports
// (registry, settings, worker-pool, etc.) read them at module-load time.
//
// Dev (`pnpm dev` → Next directly) doesn't go through bin/, so it keeps
// the `~/.reflex` default and process.cwd()-based fallbacks.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.REFLEX_HOME) {
  process.env.REFLEX_HOME = path.join(os.homedir(), ".reflex-agent");
}

// Package install root. dist/bin/preload.js → repo root is 2 levels up.
// Used by worker-pool to locate `lib/server/utilities/worker-bootstrap.js`
// without depending on `process.cwd()` (which is the user's current dir,
// not the package install location).
if (!process.env.REFLEX_PKG_ROOT) {
  process.env.REFLEX_PKG_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
}
