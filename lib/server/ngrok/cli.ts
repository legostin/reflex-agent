import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexHome } from "@/lib/reflex/home";

/**
 * Thin wrapper around the `ngrok` CLI binary. Reflex uses ngrok to expose
 * the local server to the public internet for sharing utilities, KB
 * files, and dashboards. We avoid any ngrok SDK — just spawn the CLI and
 * poll its local agent API at http://127.0.0.1:4040 to learn the public
 * URL it assigned.
 *
 * The tunnel process is tracked on `globalThis` so HMR reloads in Next
 * dev mode don't lose track of an already-running agent.
 */

interface TunnelState {
  child: ChildProcess;
  startedAt: string;
  port: number;
  domain?: string;
  /** Public URL ngrok reported (filled by pollPublicUrl). */
  publicUrl?: string;
}

const KEY = "__reflex_ngrok_tunnel__";

function getState(): TunnelState | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any)[KEY];
}
function setState(s: TunnelState | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[KEY] = s;
}

export interface TunnelStatus {
  running: boolean;
  publicUrl?: string;
  startedAt?: string;
  port?: number;
  domain?: string;
  error?: string;
}

/**
 * Return the current tunnel state. If a child process is tracked but has
 * exited, the state is cleared and `running` returns false.
 */
export function tunnelStatus(): TunnelStatus {
  const s = getState();
  if (!s) return { running: false };
  if (s.child.exitCode !== null) {
    setState(undefined);
    return { running: false };
  }
  return {
    running: true,
    ...(s.publicUrl ? { publicUrl: s.publicUrl } : {}),
    startedAt: s.startedAt,
    port: s.port,
    ...(s.domain ? { domain: s.domain } : {}),
  };
}

/**
 * Spawn `ngrok http <port> [--domain=<domain>]` with the configured
 * authtoken. Returns immediately; call `pollPublicUrl` afterwards to
 * resolve the public URL.
 */
export async function startTunnel(args: {
  port: number;
  authtoken: string;
  domain?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!args.authtoken) {
    return { ok: false, error: "ngrok authtoken is required" };
  }
  const existing = getState();
  if (existing && existing.child.exitCode === null) {
    return { ok: false, error: "Tunnel already running — stop it first." };
  }
  // Stash the authtoken in a temp config file so we don't leak it via argv.
  const cfgDir = reflexHome();
  await fs.mkdir(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, "ngrok.yml");
  await fs.writeFile(
    cfgPath,
    `version: 3\nagent:\n  authtoken: ${args.authtoken}\n`,
    { mode: 0o600 },
  );
  const argv: string[] = [
    "http",
    String(args.port),
    "--config",
    cfgPath,
    "--log",
    "stdout",
    "--log-format",
    "json",
  ];
  if (args.domain) argv.push(`--domain=${args.domain}`);
  let child: ChildProcess;
  try {
    child = spawn("ngrok", argv, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return {
      ok: false,
      error:
        "Failed to spawn ngrok — is the CLI installed and on PATH? " +
        (err instanceof Error ? err.message : String(err)),
    };
  }
  child.on("error", (e) => {
    console.error("[ngrok] spawn error:", e);
  });
  child.on("exit", (code, signal) => {
    console.log(`[ngrok] tunnel exited code=${code} signal=${signal ?? "-"}`);
    const cur = getState();
    if (cur?.child === child) setState(undefined);
  });
  // Don't let the log stream backpressure us; just drain to console.
  child.stdout?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.log("[ngrok]", line);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.error("[ngrok!]", line);
  });
  setState({
    child,
    startedAt: new Date().toISOString(),
    port: args.port,
    ...(args.domain ? { domain: args.domain } : {}),
  });
  return { ok: true };
}

/**
 * Poll ngrok's local agent API (default port 4040) until it reports the
 * public URL. Returns it on success; gives up after ~6 s.
 */
export async function pollPublicUrl(): Promise<string | null> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (res.ok) {
        const json = (await res.json()) as {
          tunnels: Array<{ public_url: string; proto: string }>;
        };
        const https = json.tunnels.find((t) => t.proto === "https");
        const any = json.tunnels[0];
        const url = https?.public_url ?? any?.public_url;
        if (url) {
          const s = getState();
          if (s) {
            s.publicUrl = url;
            setState(s);
          }
          return url;
        }
      }
    } catch {
      /* still warming up */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/**
 * Stop the ngrok child and wait for it to actually exit. We can't just
 * SIGTERM and clear state — restart needs port 4040 to be free, and a
 * fresh `ngrok http` spawned while the previous agent is still alive
 * silently dies on port collision.
 *
 * Strategy: SIGTERM, wait up to 2.5s for exit, then SIGKILL. Either way
 * we clear state once the process is confirmed dead.
 */
export function stopTunnel(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = getState();
    if (!s) {
      resolve(false);
      return;
    }
    const { child } = s;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      setState(undefined);
      resolve(ok);
    };
    child.once("exit", () => finish(true));
    // If the process already exited but the listener missed it.
    if (child.exitCode !== null) {
      finish(true);
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch (err) {
      console.error("[ngrok] SIGTERM failed:", err);
    }
    setTimeout(() => {
      if (done) return;
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone already */
      }
      finish(true);
    }, 2500);
  });
}

/**
 * Probe whether `ngrok` is present on PATH. Cheap one-shot — just runs
 * `ngrok version`. Returns the parsed version line, or null on failure.
 */
export async function ngrokVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn("ngrok", ["version"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout?.on("data", (b: Buffer) => {
        out += b.toString();
      });
      child.on("close", () => resolve(out.trim() || null));
      child.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * List reserved domains under the user's ngrok account. Requires an API
 * key (separate from the agent authtoken). Returns up to ~100 records.
 */
export async function listReservedDomains(apiKey: string): Promise<
  | { ok: true; domains: Array<{ id: string; domain: string; region: string }> }
  | { ok: false; error: string }
> {
  if (!apiKey) return { ok: false, error: "ngrok API key not configured" };
  try {
    const res = await fetch("https://api.ngrok.com/reserved_domains", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Ngrok-Version": "2",
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `ngrok API ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      reserved_domains: Array<{ id: string; domain: string; region: string }>;
    };
    return {
      ok: true,
      domains: (json.reserved_domains ?? []).map((d) => ({
        id: d.id,
        domain: d.domain,
        region: d.region,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        "ngrok API call failed: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }
}
