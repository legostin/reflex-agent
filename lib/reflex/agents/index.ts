import type { Config } from "../config.js";
import type { AgentBackend } from "./backend.js";
import { claudeCodeBackend } from "./claude-code.js";
import { codexBackend } from "./codex.js";

const BACKENDS: Record<Config["agentBackend"], AgentBackend> = {
  "claude-code": claudeCodeBackend,
  codex: codexBackend,
};

export function getBackend(cfg: Config): AgentBackend {
  const b = BACKENDS[cfg.agentBackend];
  if (!b) throw new Error(`Unknown agent backend: ${cfg.agentBackend}`);
  return b;
}

export type { AgentBackend } from "./backend.js";
