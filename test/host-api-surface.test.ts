import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Golden snapshot of the host-api method surface (north-star Phase 0 gate for
 * Phase 4). Utility bundles call these ids by string through the generated
 * `reflex.*` proxy; already-installed bundles pin them. When Phase 4 makes the
 * proxy + this id set come from `CapabilityRegistry.describe()`, this snapshot
 * proves the set is reproduced byte-identically — a silent rename would break
 * every installed utility. Extracted from source (no import, so we don't drag
 * the host-api's node-only deps into the test runtime).
 */

const SRC = fileURLToPath(
  new URL("../lib/server/utilities/host-api.ts", import.meta.url),
);

function extractMethodIds(): string[] {
  const src = readFileSync(SRC, "utf8");
  // Phase 4: dispatch is a data table (HOST_METHODS) — extract its keys.
  const start = src.indexOf("export const HOST_METHODS");
  const end = src.indexOf("\n};", start);
  const block = start >= 0 && end > start ? src.slice(start, end) : "";
  const ids = new Set<string>();
  const re = /"([^"]+)":\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) ids.add(m[1]!);
  return [...ids].sort((a, b) => a.localeCompare(b));
}

// FROZEN — changing this set is a breaking change to the utility ABI. If a
// method is genuinely added/removed, update this list IN THE SAME COMMIT and
// note the migration for installed bundles.
const FROZEN_METHOD_IDS = [
  "actions.invoke",
  "agent.invoke",
  "audit.log",
  "cards.update",
  "fs.list",
  "fs.read",
  "fs.write",
  "git.hasGhCli",
  "git.hasRemote",
  "git.isRepo",
  "git.worktree.create",
  "git.worktree.list",
  "git.worktree.merge",
  "git.worktree.remove",
  "images.attach",
  "images.generate",
  "images.pickBest",
  "images.search",
  "kb.add",
  "kb.list",
  "kb.read",
  "llm.complete",
  "mcp.call",
  "mcp.listServers",
  "mcp.listTools",
  "mermaid.validate",
  "secrets.get",
  "secrets.list",
  "sessions.search",
  "tasks.complete",
  "tasks.create",
  "tasks.delete",
  "tasks.dispatch",
  "tasks.get",
  "tasks.list",
  "tasks.observe",
  "tasks.update",
  "web.fetch",
  "web.search",
  "workflow.list",
  "workflow.read",
  "workflow.run",
].sort((a, b) => a.localeCompare(b));

describe("host-api method surface (utility ABI golden snapshot)", () => {
  it("matches the frozen id set exactly", () => {
    expect(extractMethodIds()).toEqual(FROZEN_METHOD_IDS);
  });
});
