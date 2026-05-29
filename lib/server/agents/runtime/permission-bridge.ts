import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexHome } from "@/lib/reflex/home";

/**
 * True blocking permissions for claude-code agents.
 *
 * claude 2.x dropped the `--permission-prompt-tool` CLI flag, so we gate via
 * a **PreToolUse hook** (passed through `--settings`). The hook fires before
 * every tool call and BLOCKS that call until it prints a decision — verified:
 * claude waits synchronously for the hook, and on `allow` the *same* tool call
 * runs and the agent continues from exactly where it paused (no respawn, no
 * lost work). On `deny` the agent receives the reason as a tool error.
 *
 * The hook runs as a short-lived child of the claude subprocess, so it can't
 * touch the manager's memory. It talks to Reflex through a tiny file protocol
 * under `reflexHome()/perm/<agentId>/`:
 *
 *   <toolUseId>.req.json   the hook writes this when a gated tool is hit
 *   <toolUseId>.res.json   the manager writes the user's decision here
 *   always.json            tools the user chose "always" for, this run
 *
 * The manager polls for `.req.json`, surfaces a permission-request event
 * (so Telegram + the web UI both show one card), and on the user's tap writes
 * `.res.json` — which the hook is polling for. Pre-approved tools (the agent's
 * own allow-list, passed via `REFLEX_ALLOWED`) are allowed instantly by the
 * hook with no IPC, so normal work never pays the round-trip.
 */

/** How long the hook waits for a human decision before giving up (= deny). */
export const PERM_TIMEOUT_MS = 60 * 60_000; // 1h
/** claude-side hook timeout (seconds). Kept ≥ PERM_TIMEOUT_MS so the hook
 *  always returns a clean deny first rather than being force-killed. */
const HOOK_TIMEOUT_S = 60 * 60 + 60;

export function permRoot(): string {
  return path.join(reflexHome(), "perm");
}
export function permDir(agentId: string): string {
  return path.join(permRoot(), agentId);
}
function runtimeDir(): string {
  return path.join(reflexHome(), "runtime");
}
export function hookScriptPath(): string {
  return path.join(runtimeDir(), "permission-hook.cjs");
}
export function hookSettingsPath(): string {
  return path.join(runtimeDir(), "permission-settings.json");
}

export interface BridgeRequest {
  agentId: string;
  requestId: string;
  tool: string;
  input: unknown;
  ts: string;
}

export type BridgeDecision =
  | { behavior: "allow"; message?: string }
  | { behavior: "deny"; message?: string };

// ---------------------------------------------------------------------------
// Setup (idempotent): write the hook script + settings, ensure the per-agent
// request dir exists. Called by the claude-code runtime before spawning.

export async function ensurePermissionRuntime(agentId: string): Promise<{
  settingsPath: string;
  permDir: string;
}> {
  await fs.mkdir(runtimeDir(), { recursive: true });
  await fs.mkdir(permDir(agentId), { recursive: true });
  // Rewrite both every spawn so they stay in lockstep with this source.
  await fs.writeFile(hookScriptPath(), HOOK_SCRIPT, "utf8");
  await fs.writeFile(
    hookSettingsPath(),
    JSON.stringify(hookSettings(), null, 2),
    "utf8",
  );
  return { settingsPath: hookSettingsPath(), permDir: permDir(agentId) };
}

function hookSettings(): unknown {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `node ${JSON.stringify(hookScriptPath())}`,
              timeout: HOOK_TIMEOUT_S,
            },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Manager-side helpers (in-process).

/** Scan every agent's perm dir for requests that don't yet have a decision. */
export async function readOpenRequests(): Promise<BridgeRequest[]> {
  let agentDirs: string[];
  try {
    agentDirs = await fs.readdir(permRoot());
  } catch {
    return []; // no perm root yet
  }
  const out: BridgeRequest[] = [];
  await Promise.all(
    agentDirs.map(async (agentId) => {
      const dir = permDir(agentId);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const f of files) {
        if (!f.endsWith(".req.json")) continue;
        const requestId = f.slice(0, -".req.json".length);
        // Skip if already decided.
        if (files.includes(`${requestId}.res.json`)) continue;
        try {
          const raw = await fs.readFile(path.join(dir, f), "utf8");
          const j = JSON.parse(raw) as Partial<BridgeRequest>;
          if (!j.tool) continue;
          out.push({
            agentId,
            requestId,
            tool: j.tool,
            input: j.input,
            ts: j.ts ?? new Date().toISOString(),
          });
        } catch {
          // half-written file — picked up next tick
        }
      }
    }),
  );
  return out;
}

/** Write the user's decision; the hook is polling for this file. */
export async function writeDecision(
  agentId: string,
  requestId: string,
  decision: BridgeDecision,
): Promise<void> {
  const dir = permDir(agentId);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${requestId}.res.json.tmp`);
  const target = path.join(dir, `${requestId}.res.json`);
  await fs.writeFile(tmp, JSON.stringify(decision), "utf8");
  await fs.rename(tmp, target); // atomic — the hook never reads a partial file
}

/** Record an "always allow" so the live process stops asking for this tool. */
export async function addAlwaysAllow(
  agentId: string,
  tool: string,
): Promise<void> {
  const file = path.join(permDir(agentId), "always.json");
  let list: string[] = [];
  try {
    list = JSON.parse(await fs.readFile(file, "utf8")) as string[];
  } catch {
    /* absent */
  }
  if (!list.includes(tool)) {
    list.push(tool);
    await fs.mkdir(permDir(agentId), { recursive: true });
    await fs.writeFile(file, JSON.stringify(list), "utf8");
  }
}

/** Tear down a finished agent's request dir. */
export async function cleanupAgentPerm(agentId: string): Promise<void> {
  try {
    await fs.rm(permDir(agentId), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// The hook script. Pure Node CJS, dependency-free — claude spawns it with
// `node`, outside Reflex's bundle. Reads env set on the claude subprocess:
//   REFLEX_PERM_DIR        per-agent request dir
//   REFLEX_AGENT_ID        owning agent id
//   REFLEX_ALLOWED         comma-separated pre-approved tool patterns
//   REFLEX_PERM_TIMEOUT_MS how long to wait for a decision
// NOTE: written as plain concatenation (no template literals / no `${}`) so it
// survives being embedded in this module's template string unchanged.

const HOOK_SCRIPT = `"use strict";
var fs = require("fs");
var path = require("path");

var PERM_DIR = process.env.REFLEX_PERM_DIR || "";
var AGENT_ID = process.env.REFLEX_AGENT_ID || "";
var ALLOWED = (process.env.REFLEX_ALLOWED || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
var TIMEOUT_MS = parseInt(process.env.REFLEX_PERM_TIMEOUT_MS || "3600000", 10);
var POLL_MS = 300;

function out(decision, reason) {
  var o = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } };
  if (reason) o.hookSpecificOutput.permissionDecisionReason = reason;
  process.stdout.write(JSON.stringify(o));
  process.exit(0);
}

function matchTool(tool, pat) {
  if (!pat) return false;
  if (pat === tool) return true;
  if (pat.charAt(pat.length - 1) === "*" && tool.indexOf(pat.slice(0, -1)) === 0) return true;
  var lp = pat.indexOf("(");
  if (lp > 0 && tool === pat.slice(0, lp)) return true; // "Bash(git *)" -> Bash
  return false;
}

function readAlways() {
  try { return JSON.parse(fs.readFileSync(path.join(PERM_DIR, "always.json"), "utf8")) || []; }
  catch (e) { return []; }
}

function isAllowed(tool) {
  if (!tool) return false;
  var always = readAlways();
  var i;
  for (i = 0; i < always.length; i++) if (matchTool(tool, always[i])) return true;
  for (i = 0; i < ALLOWED.length; i++) if (matchTool(tool, ALLOWED[i])) return true;
  return false;
}

var raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (c) { raw += c; });
process.stdin.on("end", function () {
  var j;
  try { j = JSON.parse(raw || "{}"); }
  catch (e) { return out("allow"); } // can't identify the call — never block real work
  var tool = j.tool_name || "";
  if (isAllowed(tool)) return out("allow");
  // Gated tool: hand off to Reflex and block until a decision lands.
  var id = j.tool_use_id || ("perm-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
  var reqPath = path.join(PERM_DIR, id + ".req.json");
  var resPath = path.join(PERM_DIR, id + ".res.json");
  try {
    fs.mkdirSync(PERM_DIR, { recursive: true });
    var tmp = reqPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ agentId: AGENT_ID, requestId: id, tool: tool, input: j.tool_input, ts: new Date().toISOString() }));
    fs.renameSync(tmp, reqPath); // atomic — the poller never reads a partial file
  } catch (e) {
    return out("deny", "Reflex permission bridge unavailable: " + (e && e.message));
  }
  var deadline = Date.now() + TIMEOUT_MS;
  function cleanup() {
    try { fs.unlinkSync(reqPath); } catch (e) {}
    try { fs.unlinkSync(resPath); } catch (e) {}
  }
  function poll() {
    var res = null;
    try { res = fs.readFileSync(resPath, "utf8"); } catch (e) { res = null; }
    if (res) {
      var d = null;
      try { d = JSON.parse(res); } catch (e) { d = null; }
      cleanup();
      if (d && d.behavior === "allow") return out("allow", d.message);
      return out("deny", (d && d.message) || "Denied by user.");
    }
    if (Date.now() > deadline) {
      cleanup();
      return out("deny", "No response — timed out waiting for your approval.");
    }
    setTimeout(poll, POLL_MS);
  }
  poll();
});
`;
