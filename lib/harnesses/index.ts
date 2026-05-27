import type { HarnessId } from "@/lib/settings";
import { claudeCodeHarness } from "./claude-code";
import { codexHarness } from "./codex";
import { ollamaHarness } from "./ollama";
import type { Harness } from "./types";

const REGISTRY: Record<HarnessId, Harness> = {
  "claude-code": claudeCodeHarness,
  codex: codexHarness,
  ollama: ollamaHarness,
};

export function getHarness(id: HarnessId): Harness {
  return REGISTRY[id];
}

export function listHarnesses(): Harness[] {
  return Object.values(REGISTRY);
}

export type { Harness, ModelInfo, ProbeResult } from "./types";
