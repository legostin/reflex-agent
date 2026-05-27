import { loadSettings } from "@/lib/settings/store";
import type { Harness, ModelInfo, ProbeResult } from "./types";

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    size?: number;
    details?: {
      parameter_size?: string;
      family?: string;
      families?: string[];
    };
  }>;
}

async function baseUrl(): Promise<string> {
  const s = await loadSettings();
  return s.harnesses.ollama.baseUrl.replace(/\/$/, "");
}

export const ollamaHarness: Harness = {
  id: "ollama",
  label: "Ollama",
  supports: ["rag", "embed", "chat", "quick"],

  async probe(): Promise<ProbeResult> {
    const url = await baseUrl();
    try {
      const r = await fetch(`${url}/api/version`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) {
        return {
          ok: false,
          available: false,
          detail: `HTTP ${r.status} at ${url}`,
        };
      }
      const body = (await r.json()) as { version?: string };
      return {
        ok: true,
        available: true,
        detail: body.version ? `v${body.version}` : "reachable",
      };
    } catch (err) {
      return {
        ok: false,
        available: false,
        detail:
          err instanceof Error
            ? `${err.message} (${url})`
            : `unreachable: ${url}`,
      };
    }
  },

  async listModels(): Promise<ModelInfo[]> {
    const url = await baseUrl();
    const r = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) {
      throw new Error(`Ollama /api/tags returned HTTP ${r.status}`);
    }
    const body = (await r.json()) as OllamaTagsResponse;
    const out: ModelInfo[] = [];
    for (const m of body.models ?? []) {
      out.push({
        id: m.name,
        label: m.name,
        family: m.details?.family,
        size: m.details?.parameter_size ?? formatBytes(m.size),
        source: "live",
      });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  },
};

function formatBytes(n?: number): string | undefined {
  if (typeof n !== "number") return undefined;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}
