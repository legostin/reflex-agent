import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { reflexHome } from "../home.js";

interface StartOptions {
  port: number;
  host: string;
  open: boolean;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const pkgRoot = await findPackageRoot();
  await assertBuilt(pkgRoot);
  await rewriteBuildPaths(pkgRoot);

  // Lazy-import to avoid pulling Next into CLI-only commands.
  const nextMod = (await import("next")) as unknown as {
    default: (opts: { dev: boolean; dir: string }) => {
      prepare(): Promise<void>;
      getRequestHandler(): (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => Promise<void>;
    };
  };
  const app = nextMod.default({ dev: false, dir: pkgRoot });
  await app.prepare();
  const handler = app.getRequestHandler();

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      const url = `http://${displayHost(opts.host)}:${opts.port}`;
      process.stdout.write(`Reflex running at ${url}\n`);
      process.stdout.write(`Data dir: ${reflexHome()}\n`);
      if (opts.open) openBrowser(url);
      // Self-ping so the root layout renders once on boot — that's what
      // starts the background workers (scheduler + Telegram poller).
      // Without it a Telegram-only user who never opens the web UI would
      // get a server with no poller. Fire-and-forget, retried briefly.
      void warmup(`http://127.0.0.1:${opts.port}/`);
    });
    const shutdown = (signal: NodeJS.Signals) => {
      process.stdout.write(`\n[reflex] ${signal} received, stopping…\n`);
      server.close(() => resolve());
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/**
 * Hit the home URL a few times until it answers, so the root layout
 * renders and boots the background workers. Tolerant of the brief window
 * before Next is fully ready.
 */
async function warmup(url: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function findPackageRoot(): Promise<string> {
  // dist/lib/reflex/commands/start.js → repo root is 4 levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..");
}

async function assertBuilt(pkgRoot: string): Promise<void> {
  const required = path.join(pkgRoot, ".next", "BUILD_ID");
  try {
    await fs.access(required);
  } catch {
    throw new Error(
      `Reflex web bundle not found at ${pkgRoot}/.next. If running from source, run \`pnpm run build\` first.`,
    );
  }
}

/**
 * Next bakes the build-time project path into `required-server-files.json`
 * (`appDir`, `outputFileTracingRoot`). When the package is built in CI and
 * installed on a user's machine those paths point at `/home/runner/...`
 * which doesn't exist — rewrite them to the actual install location.
 *
 * Idempotent: if the values already match `pkgRoot`, skip the write.
 */
async function rewriteBuildPaths(pkgRoot: string): Promise<void> {
  const file = path.join(pkgRoot, ".next", "required-server-files.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  const data = JSON.parse(raw) as Record<string, unknown> & {
    appDir?: string;
    config?: { outputFileTracingRoot?: string };
  };
  let changed = false;
  if (data.appDir && data.appDir !== pkgRoot) {
    data.appDir = pkgRoot;
    changed = true;
  }
  if (
    data.config?.outputFileTracingRoot &&
    data.config.outputFileTracingRoot !== pkgRoot
  ) {
    data.config.outputFileTracingRoot = pkgRoot;
    changed = true;
  }
  if (changed) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "localhost";
  return host;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Browser launch is best-effort.
  }
}
