import "server-only";
import type { AgentEvent } from "../types";
import { generateImage, type GenProvider } from "@/lib/server/images/service";
import { rootId as computeRootId } from "@/lib/registry";

/**
 * The `image-gen` agent runtime. Unlike claude-code/codex/ollama this isn't
 * a streaming LLM subprocess — it's a single-shot call to the image service
 * that emits one `assistant-delta` with a markdown image reference, then
 * returns. Modelling it as an agent (with a HarnessId) means it gets a
 * sidebar row, an audit trail and is callable from
 * `reflex.agent.invoke({harness: "image-gen", prompt: ...})`.
 *
 * Prompt format: either a plain text prompt (uses Gemini + defaults) or a
 * JSON envelope:
 *   {"prompt": "...", "provider": "gemini"|"codex", "size": "1024x1024",
 *    "aspectRatio": "16:9", "alt": "..."}
 */

interface Runtime {
  meta: { id: string };
  args: {
    rootPath: string;
    prompt: string;
  };
  manager: {
    emit: (event: AgentEvent) => Promise<void>;
  };
}

interface ParsedPrompt {
  prompt: string;
  provider?: GenProvider;
  size?: string;
  aspectRatio?: string;
  alt?: string;
}

function parsePrompt(raw: string): ParsedPrompt {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const out: ParsedPrompt = {
        prompt:
          typeof obj.prompt === "string" && obj.prompt.trim().length > 0
            ? obj.prompt
            : trimmed,
      };
      if (obj.provider === "gemini" || obj.provider === "codex") {
        out.provider = obj.provider;
      }
      if (typeof obj.size === "string") out.size = obj.size;
      if (typeof obj.aspectRatio === "string") out.aspectRatio = obj.aspectRatio;
      if (typeof obj.alt === "string") out.alt = obj.alt;
      return out;
    } catch {
      /* fall through — treat as plain text */
    }
  }
  return { prompt: trimmed };
}

export async function runImageGen(rt: Runtime): Promise<void> {
  const parsed = parsePrompt(rt.args.prompt);
  const rootId = computeRootId(rt.args.rootPath);
  try {
    const result = await generateImage({
      rootId,
      prompt: parsed.prompt,
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      ...(parsed.size ? { size: parsed.size } : {}),
      ...(parsed.aspectRatio ? { aspectRatio: parsed.aspectRatio } : {}),
      ...(parsed.alt ? { alt: parsed.alt } : {}),
    });
    const alt = parsed.alt || parsed.prompt;
    const text =
      `![${escapeAlt(alt)}](${result.urlPath})\n\n` +
      `_сгенерировано: ${result.provider} · ${formatBytes(result.size)}_\n`;
    await rt.manager.emit({
      type: "assistant-delta",
      text,
      agentId: rt.meta.id,
      ts: new Date().toISOString(),
      seq: 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await rt.manager.emit({
      type: "assistant-delta",
      text: `Не удалось сгенерировать картинку: ${msg}\n`,
      agentId: rt.meta.id,
      ts: new Date().toISOString(),
      seq: 0,
    });
    throw err;
  }
}

function escapeAlt(s: string): string {
  return s.replace(/[\[\]\n]/g, " ").slice(0, 200);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
