import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { getBackend } from "../agents/index.js";
import { REFLEX_DIR, mirrorInReflex, reflexRoot } from "../paths.js";

export async function runChat(targetInput: string): Promise<void> {
  const target = path.resolve(targetInput);
  await assertDir(target);
  const root = await findReflexRoot(target);
  if (!root) {
    throw new Error(
      `No ${REFLEX_DIR}/ found at or above ${target}. Run \`reflex init <dir>\` first.`,
    );
  }
  const cfg = await loadConfig(root);
  const relScope = path.relative(root, target);
  const reflexScope = relScope
    ? mirrorInReflex(root, relScope)
    : reflexRoot(root);

  const backend = getBackend(cfg);
  await backend.chat({ root, scope: target, reflexScope });
}

async function assertDir(p: string): Promise<void> {
  const stat = await fs.stat(p).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${p}`);
  }
}

/** Walk upward from `start` looking for a directory containing `.reflex/`. */
async function findReflexRoot(start: string): Promise<string | null> {
  let cur = start;
  while (true) {
    const candidate = path.join(cur, REFLEX_DIR);
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat && stat.isDirectory()) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
