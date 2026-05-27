import { execa } from "execa";
import type { Harness, ModelInfo, ProbeResult } from "./types";

const CLI = "claude";

/** Fallback list used when the Anthropic API isn't reachable / no key set. */
const STATIC_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    family: "opus",
    source: "static",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    family: "sonnet",
    source: "static",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    family: "haiku",
    source: "static",
  },
];

interface AnthropicModelsResponse {
  data?: Array<{
    id: string;
    display_name?: string;
    type?: string;
    created_at?: string;
  }>;
}

export const claudeCodeHarness: Harness = {
  id: "claude-code",
  label: "Claude Code",
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
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return STATIC_MODELS;
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return STATIC_MODELS;
      const body = (await res.json()) as AnthropicModelsResponse;
      const out: ModelInfo[] = [];
      for (const m of body.data ?? []) {
        if (!m.id) continue;
        out.push({
          id: m.id,
          label: m.display_name ?? m.id,
          family: deriveFamily(m.id),
          source: "live",
        });
      }
      if (out.length === 0) return STATIC_MODELS;
      // Newest first when created_at is present; fallback alphabetical.
      out.sort((a, b) => a.id.localeCompare(b.id));
      return out;
    } catch {
      return STATIC_MODELS;
    }
  },
};

function deriveFamily(id: string): string | undefined {
  const lower = id.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return undefined;
}
