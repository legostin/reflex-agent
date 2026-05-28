/**
 * Next.js server instrumentation hook. Next calls `register()` once on server
 * startup, before any request is handled — the deterministic boot path for
 * background workers, versus the `app/layout.tsx` render side-effect which only
 * fires on the first browser request (so a Telegram-only user who never opens
 * the web UI would otherwise get a server with no poller).
 *
 * IMPORTANT — runtime guard shape: Next compiles this file for BOTH the nodejs
 * and edge runtimes. The boot graph reaches the agent runtime → execa →
 * cross-spawn → node builtins (child_process/fs/path), which the edge runtime
 * cannot resolve. The POSITIVE `=== "nodejs"` block lets webpack constant-fold
 * `process.env.NEXT_RUNTIME` and dead-code-eliminate the dynamic import out of
 * the edge build entirely. An early `!== "nodejs"` return does NOT get DCE'd
 * and pulls node builtins into the edge bundle (build failure).
 *
 * This is the SOLE boot path (the app/layout.tsx side-effect was removed).
 * `register()` runs exactly once per server, in the single API-serving Node
 * process — including under `reflex start`'s programmatic `createServer` (the
 * GO/NO-GO spike confirmed it fires at startup, before listen). That is what
 * lets us drop the layout.tsx boot, which `next dev` was evaluating in several
 * render-worker processes (separate globalThis each) → one Telegram poller per
 * worker → 409 + duplicate processing. One hook, one process, one poller.
 *
 * The positive `=== "nodejs"` guard (not an early `!== "nodejs"` return) lets
 * webpack constant-fold and dead-code-eliminate the node-only boot graph
 * (execa → cross-spawn → child_process) out of the edge-runtime build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootWorkers } = await import("./lib/server/instrumentation");
    await bootWorkers();
  }
}
