import { execa } from "execa";
import type { Harness, ModelInfo, ProbeResult } from "./types";

const CLI = "codex";

// Backstop list for users who haven't `codex login`'d yet (app-server
// can't query model/list without an authenticated session). Refreshed
// over time so the Settings dropdown isn't confusingly empty in that
// edge case.
const FALLBACK_MODELS: ModelInfo[] = [
  { id: "gpt-5.5", label: "GPT-5.5", source: "static" },
  { id: "gpt-5.4", label: "GPT-5.4", source: "static" },
  { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", source: "static" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", source: "static" },
];

export const codexHarness: Harness = {
  id: "codex",
  label: "Codex",
  supports: ["analyze", "chat", "quick"],

  async probe(): Promise<ProbeResult> {
    try {
      const r = await execa(CLI, ["--version"], { timeout: 3000 });
      return {
        ok: true,
        available: true,
        detail: r.stdout.trim() || "installed",
      };
    } catch (err) {
      return {
        ok: false,
        available: false,
        detail: err instanceof Error ? err.message : "not installed",
      };
    }
  },

  async listModels(): Promise<ModelInfo[]> {
    // Canonical source: Codex App Server's `model/list` JSON-RPC — same
    // list the Codex CLI itself uses, including ChatGPT-subscription
    // models that don't appear in OpenAI's public `/v1/models`.
    try {
      const { listCodexModels } = await import(
        "@/lib/server/codex/client"
      );
      const live = await listCodexModels();
      const visible = live.filter((m) => !m.hidden);
      if (visible.length === 0) return FALLBACK_MODELS;
      // Sort: default first, then by id. Settings UI shows the first
      // entry as the chosen model when nothing is saved yet.
      visible.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
      return visible.map((m) => ({
        id: m.id,
        label: m.displayName || m.id,
        source: "live",
      }));
    } catch {
      return FALLBACK_MODELS;
    }
  },
};
