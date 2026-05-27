/**
 * A "harness" is a way to talk to a model. Reflex routes each task type
 * (analyze/chat/rag/embed) through one of these. Keep the contract minimal
 * so we can add more (Anthropic API, OpenAI, local llama.cpp, …) without
 * touching consumers.
 */

import type { HarnessId, TaskId } from "@/lib/settings";

export interface ModelInfo {
  id: string;
  label: string;
  family?: string;
  /** Free-form size hint (parameter count, "8B", "70B", or bytes for ollama). */
  size?: string;
  /** Where this entry came from — useful for the UI badge. */
  source: "live" | "static";
}

export interface ProbeResult {
  ok: boolean;
  /** Short status string for the UI ("v2.1.143", "not installed", "11434 unreachable"). */
  detail: string;
  /** True when the user can actually use this harness right now. */
  available: boolean;
}

export interface Harness {
  readonly id: HarnessId;
  readonly label: string;
  /** Tasks this harness is meaningful for. Used to filter the UI dropdowns. */
  readonly supports: ReadonlyArray<TaskId>;
  probe(): Promise<ProbeResult>;
  listModels(): Promise<ModelInfo[]>;
}
