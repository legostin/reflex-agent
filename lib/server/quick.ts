import "server-only";
import { execa } from "execa";
import { loadSettings } from "@/lib/settings/store";
import type { Assignment } from "@/lib/settings/schema";

/**
 * One-shot completion against any harness. No streaming, no tools. Use for
 * cheap operations: title generation, labelling, summarising.
 *
 * Returns the model's plain text reply. Throws on transport / CLI failure.
 */
export async function quickComplete(
  assignment: Assignment,
  prompt: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const timeout = opts?.timeoutMs ?? 30_000;
  if (assignment.harness === "claude-code") {
    const r = await execa(
      "claude",
      [
        "-p",
        prompt,
        "--permission-mode",
        "default",
        "--allowedTools",
        "",
        "--model",
        assignment.model,
      ],
      { timeout, stdio: ["ignore", "pipe", "pipe"] },
    );
    return r.stdout.trim();
  }
  if (assignment.harness === "codex") {
    const r = await execa(
      "codex",
      [
        "exec",
        "--sandbox",
        "read-only",
        "--model",
        assignment.model,
        prompt,
      ],
      { timeout, stdio: ["ignore", "pipe", "pipe"] },
    );
    return r.stdout.trim();
  }
  if (assignment.harness === "ollama") {
    const settings = await loadSettings();
    const url = settings.harnesses.ollama.baseUrl.replace(/\/$/, "");
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: assignment.model,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      throw new Error(`Ollama /api/generate HTTP ${res.status}`);
    }
    const body = (await res.json()) as { response?: string };
    return (body.response ?? "").trim();
  }
  throw new Error(`Unsupported quick harness: ${assignment.harness}`);
}
