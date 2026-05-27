import "server-only";
import { Codex } from "@openai/codex-sdk";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Singleton Codex SDK wrapper. The SDK shells out to `codex exec` and
 * streams structured events back — we share one `Codex` instance across
 * all Reflex agents because the SDK is stateless (each `startThread` is
 * an independent CLI invocation; one Codex instance just caches CLI
 * config + the resolved binary path).
 *
 * Auth is inherited from the user's existing `codex login` — no API key
 * needed unless OPENAI_API_KEY is set, in which case the SDK switches
 * to API-key billing.
 */

let codexSingleton: Codex | null = null;

export function getCodexClient(): Codex {
  if (!codexSingleton) {
    codexSingleton = new Codex();
  }
  return codexSingleton;
}

/**
 * Install Reflex's bundled `imagegen` skill into the user's
 * `$CODEX_HOME/skills/.system/imagegen/SKILL.md` slot if it isn't
 * already there. Works around the bug where the bundled skill that
 * ships with Codex CLI sometimes fails to materialise on disk
 * (openai/codex#20946) — without the file present, `$imagegen` resolves
 * to nothing and the agent silently does nothing.
 *
 * Idempotent: skips when the destination exists. We intentionally do
 * NOT overwrite an existing file — the user (or a newer Codex install)
 * may already have a richer version with scripts/ and references/.
 */
let installPromise: Promise<void> | null = null;

export async function ensureImagegenSkillInstalled(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const targetDir = path.join(codexHome, "skills", ".system", "imagegen");
    const targetFile = path.join(targetDir, "SKILL.md");
    try {
      await fs.access(targetFile);
      return;
    } catch {
      /* missing — install our copy */
    }
    const bundled = path.join(
      process.cwd(),
      "lib",
      "server",
      "codex",
      "skills",
      "imagegen",
      "SKILL.md",
    );
    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(bundled, targetFile);
    } catch (err) {
      // Non-fatal: image gen will just fail at runtime with a clearer
      // error than a silent no-op. Best to log and continue.
      // eslint-disable-next-line no-console
      console.warn(
        "Failed to install Reflex imagegen skill into $CODEX_HOME:",
        err instanceof Error ? err.message : err,
      );
    }
  })();
  return installPromise;
}

/**
 * Where Codex CLI saves images produced by the built-in `image_gen` tool
 * (per the SKILL.md save-path policy). Resolved at call time so changes
 * to CODEX_HOME between turns are picked up.
 */
export function generatedImagesDir(): string {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "generated_images");
}

/**
 * Live model list from Codex App Server. Spawns `codex app-server` as a
 * short-lived subprocess, handshakes JSON-RPC, sends `model/list`, kills
 * the process. Returns the canonical model set Codex itself would expose
 * to the user — including ChatGPT-subscription-only models that the
 * public `/v1/models` OpenAI endpoint doesn't.
 *
 * Cached in-memory for 60s so the Settings UI doesn't spawn a process
 * on every model dropdown re-render.
 */
export interface CodexAppServerModel {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
}

let modelCache: { at: number; models: CodexAppServerModel[] } | null = null;
const MODEL_CACHE_TTL_MS = 60_000;

export async function listCodexModels(
  opts: { force?: boolean } = {},
): Promise<CodexAppServerModel[]> {
  if (!opts.force && modelCache && Date.now() - modelCache.at < MODEL_CACHE_TTL_MS) {
    return modelCache.models;
  }
  const models = await fetchCodexModelsFromAppServer();
  modelCache = { at: Date.now(), models };
  return models;
}

interface RawModel {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
}

async function fetchCodexModelsFromAppServer(): Promise<CodexAppServerModel[]> {
  return new Promise<CodexAppServerModel[]>((resolve, reject) => {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      // Codex CLI inherits env from its parent for OPENAI_API_KEY etc.
    });
    let buf = "";
    let settled = false;
    const cleanup = (): void => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("codex app-server model/list timed out"));
    }, 10_000);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.length > 0) {
          try {
            const msg = JSON.parse(line) as {
              id?: number;
              result?: { data?: RawModel[] };
            };
            if (msg.id === 2 && msg.result && Array.isArray(msg.result.data)) {
              const out: CodexAppServerModel[] = [];
              for (const m of msg.result.data) {
                if (typeof m?.id !== "string") continue;
                out.push({
                  id: m.id,
                  displayName:
                    typeof m.displayName === "string" ? m.displayName : m.id,
                  description:
                    typeof m.description === "string" ? m.description : "",
                  hidden: m.hidden === true,
                  isDefault: m.isDefault === true,
                });
              }
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                cleanup();
                resolve(out);
                return;
              }
            }
          } catch {
            /* not JSON or not our response — skip */
          }
        }
        nl = buf.indexOf("\n");
      }
    });

    // Drain stderr quietly — keeps the pipe from filling up.
    child.stderr.on("data", () => {
      /* ignore */
    });

    // Handshake. The server processes one message at a time off stdin,
    // so we can write them back-to-back without sleeps — but we DO need
    // the `initialized` notification before any further requests will
    // be handled.
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "reflex", title: "Reflex", version: "0.0.0" },
          capabilities: {},
        },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "model/list",
        params: {},
      }) + "\n",
    );
    child.stdin.end();
  });
}

/**
 * Delete the Codex session/rollout file for a thread we just ran. Keeps
 * Reflex's ephemeral Codex turns out of `codex resume` / Codex Desktop's
 * thread list — Reflex has its own topic memory, so we don't need
 * Codex's session persistence.
 *
 * Sessions live at
 *   `~/.codex/sessions/YYYY/MM/DD/rollout-…-<threadId>.jsonl`
 * where the date components are LOCAL time of session start. We scan a
 * 3-day window (yesterday/today/tomorrow) for the file containing our
 * threadId. Best-effort: silently ignores missing dirs or unlink races.
 */
export async function deleteCodexSession(
  threadId: string | null,
): Promise<void> {
  if (!threadId) return;
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const sessionsRoot = path.join(codexHome, "sessions");
  const now = new Date();
  const offsets = [-1, 0, 1]; // yesterday / today / tomorrow (clock-skew safety)
  for (const off of offsets) {
    const d = new Date(now);
    d.setDate(d.getDate() + off);
    const dir = path.join(
      sessionsRoot,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    );
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.includes(threadId)) {
        await fs.unlink(path.join(dir, name)).catch(() => {
          /* ignore — file may already be gone */
        });
      }
    }
  }
}
