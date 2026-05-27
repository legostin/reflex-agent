import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { InstalledUtility, ServerAction } from "./types";
import { actionBundlePath } from "./build";
import { dispatchHostCall, type Channel } from "./host-api";
import { appendAudit } from "./audit";

/**
 * Single-shot Worker invocations for utility server actions. We deliberately
 * tear the Worker down after each call: no shared state between invocations,
 * simplest mental model, and gives us a clean timeout/kill story.
 *
 * The Worker bootstrap is loaded from `worker-bootstrap.js` next to this file.
 * The action bundle is prepended at build time with a shim that maps
 * `@host/api` to `globalThis.__reflexHost`.
 */

/**
 * Resolve the absolute path of `worker-bootstrap.js` for `new Worker()`.
 *
 * Three execution contexts:
 *   1. Prod CLI (`reflex start`): `REFLEX_PKG_ROOT` is set by bin/preload.ts
 *      to the npm install location; that's where the shipped JS lives.
 *   2. Dev (`pnpm dev`): no env var, but `process.cwd()` is the repo root.
 *   3. Anything else: try `require.resolve`, but inside Next webpack it
 *      returns a numeric module ID — guard with `typeof === "string"`
 *      before `path.isAbsolute` (which throws on non-strings).
 */
function resolveBootstrap(): string {
  const rel = "lib/server/utilities/worker-bootstrap.js";
  const pkgRoot = process.env.REFLEX_PKG_ROOT;
  if (pkgRoot) {
    return path.resolve(pkgRoot, rel);
  }
  let candidate: unknown = null;
  try {
    candidate = require.resolve("./worker-bootstrap.js");
  } catch {
    /* fall through */
  }
  if (typeof candidate === "string" && path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(process.cwd(), rel);
}

interface RunArgs {
  utility: InstalledUtility;
  action: ServerAction;
  args: unknown;
  parentCorrelationId?: string;
}

export async function runServerAction(rt: RunArgs): Promise<unknown> {
  const bundlePath = actionBundlePath(rt.utility.dir, rt.action.name);
  const bundleUrl = pathToFileURL(bundlePath).toString();
  const bootstrapPath = resolveBootstrap();

  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(bootstrapPath, {
      workerData: {
        bundleUrl,
        actionName: rt.action.name,
        utilityId: rt.utility.manifest.id,
        scope: rt.utility.scope,
      },
      env: {},
      eval: false,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      },
    });

    let settled = false;
    const finish = (
      err: Error | null,
      value?: unknown,
      reason?: string,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.terminate().catch(() => {
        // ignore
      });
      if (err) {
        void appendAudit({
          ts: new Date().toISOString(),
          utilityId: rt.utility.manifest.id,
          scope: rt.utility.scope,
          channel: "worker",
          method: `action:${rt.action.name}`,
          phase: "end",
          correlationId: rt.parentCorrelationId ?? "(detached)",
          error: reason ?? err.message,
        });
        reject(err);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error("server action timed out"), undefined, "timeout");
    }, rt.action.timeoutMs);

    worker.on("error", (err) => finish(err));
    worker.on("exit", (code) => {
      if (code !== 0)
        finish(new Error(`worker exited with code ${code}`));
    });
    worker.on("message", async (msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as Record<string, unknown>;
      if (m.type === "host-rpc") {
        const id = m.id as number;
        const method = m.method as string;
        const args = m.args;
        try {
          const result = await dispatchHostCall(
            {
              utility: rt.utility,
              channel: "worker" as Channel,
              ...(rt.parentCorrelationId
                ? { parentCorrelationId: rt.parentCorrelationId }
                : {}),
            },
            method,
            args,
          );
          worker.postMessage({ type: "host-rpc-result", id, ok: true, result });
        } catch (err) {
          worker.postMessage({
            type: "host-rpc-result",
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (m.type === "invoke-result") {
        if (m.ok) finish(null, m.result);
        else
          finish(new Error((m.error as string) || "server action failed"));
      }
    });

    worker.postMessage({ type: "invoke", args: rt.args });
  });
}

// Re-export for callers that just want to introspect — currently unused.
export { fileURLToPath };
