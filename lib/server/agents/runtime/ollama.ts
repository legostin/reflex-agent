import "server-only";
import { loadSettings } from "@/lib/settings/store";
import type { AgentEvent } from "../types";

/**
 * Ollama one-shot/stream completion runtime. Used for sub-agents (quick
 * title-gen, RAG) and as a chat backend when configured. Streams chunks via
 * `/api/generate stream:true`.
 */

interface Runtime {
  meta: { id: string };
  args: {
    systemPrompt: string;
    prompt: string;
    model: string;
  };
  manager: {
    emit: (event: AgentEvent) => Promise<void>;
  };
}

interface OllamaGenerateChunk {
  response?: string;
  done?: boolean;
  error?: string;
}

export async function runOllama(rt: Runtime): Promise<void> {
  const settings = await loadSettings();
  const url = settings.harnesses.ollama.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: rt.args.model,
      system: rt.args.systemPrompt,
      prompt: rt.args.prompt,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama /api/generate HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line) as OllamaGenerateChunk;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.response) {
          await rt.manager.emit({
            type: "assistant-delta",
            text: chunk.response,
            agentId: rt.meta.id,
            ts: new Date().toISOString(),
            seq: 0,
          });
        }
      } catch {
        // skip malformed chunk
      }
    }
  }
}
