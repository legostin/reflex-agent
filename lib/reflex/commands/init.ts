import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, writeConfig, type Config } from "../config.js";
import { getBackend } from "../agents/index.js";
import { ensureReflexIgnoreTemplate, snapshotScope } from "../kb.js";
import { reflexRoot } from "../paths.js";

export interface InitOptions {
  /** Skip the agent pass; only scaffold .reflex/, config, .reflexignore. */
  scaffoldOnly?: boolean;
  /** Override `agentBackend` from the per-root config. */
  harness?: Config["agentBackend"];
  /** Model id to pass to the underlying CLI (e.g. `claude-opus-4-7`). */
  model?: string;
  /** Language artifacts should be generated in (e.g. "english", "русский"). */
  language?: string;
}

export async function runInit(
  dirInput: string,
  options: InitOptions = {},
): Promise<void> {
  const root = path.resolve(dirInput);
  await assertDir(root);

  await fs.mkdir(reflexRoot(root), { recursive: true });
  const cfg = await loadConfig(root);
  await writeConfig(root, cfg); // persist normalized config
  await ensureReflexIgnoreTemplate(root);

  if (options.scaffoldOnly) {
    process.stdout.write(
      `Reflex scaffolded at ${reflexRoot(root)} (scaffold-only).\n`,
    );
    return;
  }

  const effectiveCfg: Config = options.harness
    ? { ...cfg, agentBackend: options.harness }
    : cfg;
  const snapshot = await snapshotScope({ root, scope: root });
  const scopeWithOverrides = {
    ...snapshot,
    ...(options.model ? { model: options.model } : {}),
    ...(options.language ? { language: options.language } : {}),
  };
  process.stdout.write(
    `Running ${effectiveCfg.agentBackend}${
      options.model ? ` (${options.model})` : ""
    }${options.language ? ` [lang=${options.language}]` : ""} over ${root} (${snapshot.files.length} files visible)…\n`,
  );

  const backend = getBackend(effectiveCfg);
  await backend.analyzeScope(scopeWithOverrides);

  process.stdout.write(`Done. KB written under ${reflexRoot(root)}\n`);
}

async function assertDir(p: string): Promise<void> {
  const stat = await fs.stat(p).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${p}`);
  }
}
