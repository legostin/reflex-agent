import "server-only";
import { deleteCodexSession, getCodexClient } from "@/lib/server/codex/client";
import type { AgentEvent } from "../types";

/**
 * Codex runtime — drives Codex through the official `@openai/codex-sdk`
 * (which under the hood spawns `codex exec` with the structured JSONL
 * protocol). One thread per turn: Reflex's manager already keeps its own
 * topic-level memory; we don't piggyback on Codex's session persistence.
 *
 * The SDK streams `ThreadEvent`s — we translate them into Reflex's
 * harness-agnostic event shape (`assistant-delta`, `tool-use`, etc.) so
 * chat-view doesn't need to know which harness produced what.
 */

interface Runtime {
  meta: { id: string };
  args: {
    rootPath: string;
    reflexScope: string;
    systemPrompt: string;
    prompt: string;
    model: string;
  };
  manager: {
    emit: (event: AgentEvent) => Promise<void>;
  };
}

export async function runCodex(rt: Runtime): Promise<void> {
  const codex = getCodexClient();
  const thread = codex.startThread({
    model: rt.args.model,
    workingDirectory: rt.args.rootPath,
    sandboxMode: "read-only",
    additionalDirectories: [rt.args.reflexScope],
    // Reflex enforces its own approval flow via `<<reflex:permission>>`
    // markers post-turn; we run Codex non-interactively here.
    approvalPolicy: "never",
    skipGitRepoCheck: true,
  });

  // Combined prompt: system instructions + user input. Codex SDK lacks a
  // dedicated system-prompt slot in the typed input, so we prepend.
  const combinedInput =
    rt.args.systemPrompt.trim().length > 0
      ? `${rt.args.systemPrompt}\n\n${rt.args.prompt}`
      : rt.args.prompt;

  const stream = await thread.runStreamed(combinedInput);

  // Track text already emitted per agent-message item so we can emit
  // only the delta on each `item.updated`/`item.completed` event.
  const emittedTextById = new Map<string, string>();

  try {
  for await (const event of stream.events) {
    if (event.type === "item.started") {
      // Some clients want to see "thinking…" hints before tokens arrive.
      // We currently skip these — `assistant-delta` events do the work.
      continue;
    }

    if (
      event.type === "item.updated" ||
      event.type === "item.completed"
    ) {
      const item = event.item;
      if (item.type === "agent_message") {
        const already = emittedTextById.get(item.id) ?? "";
        const fresh = item.text.slice(already.length);
        if (fresh.length > 0) {
          emittedTextById.set(item.id, item.text);
          await rt.manager.emit({
            type: "assistant-delta",
            text: fresh,
            agentId: rt.meta.id,
            ts: new Date().toISOString(),
            seq: 0,
          });
        }
        continue;
      }
      if (item.type === "command_execution" && event.type === "item.completed") {
        // Surface only the final command — intermediate "in_progress"
        // updates pile up noise. Reflex chat-view renders tool-result.
        await rt.manager.emit({
          type: "tool-use",
          toolUseId: item.id,
          name: "Bash",
          input: { command: item.command },
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        await rt.manager.emit({
          type: "tool-result",
          toolUseId: item.id,
          content: item.aggregated_output ?? "",
          ...(item.exit_code !== 0 ? { isError: true } : {}),
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        continue;
      }
      if (item.type === "file_change" && event.type === "item.completed") {
        await rt.manager.emit({
          type: "tool-use",
          toolUseId: item.id,
          name: "FileChange",
          input: { changes: item.changes },
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        await rt.manager.emit({
          type: "tool-result",
          toolUseId: item.id,
          content: `${item.status}: ${item.changes
            .map((c) => `${c.kind} ${c.path}`)
            .join(", ")}`,
          ...(item.status === "failed" ? { isError: true } : {}),
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        continue;
      }
      if (item.type === "mcp_tool_call" && event.type === "item.completed") {
        await rt.manager.emit({
          type: "tool-use",
          toolUseId: item.id,
          name: `mcp:${item.server}:${item.tool}`,
          input: item.arguments,
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        const content = item.error
          ? item.error.message
          : JSON.stringify(item.result?.content ?? []).slice(0, 4_000);
        await rt.manager.emit({
          type: "tool-result",
          toolUseId: item.id,
          content,
          ...(item.error ? { isError: true } : {}),
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        continue;
      }
      if (item.type === "web_search" && event.type === "item.completed") {
        await rt.manager.emit({
          type: "tool-use",
          toolUseId: item.id,
          name: "WebSearch",
          input: { query: item.query },
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        continue;
      }
      if (item.type === "error" && event.type === "item.completed") {
        await rt.manager.emit({
          type: "error",
          message: item.message,
          agentId: rt.meta.id,
          ts: new Date().toISOString(),
          seq: 0,
        });
        continue;
      }
      // reasoning / todo_list — surface as system hints (optional, low
      // volume). Reasoning text can be long; skip by default to avoid
      // flooding the log.
      continue;
    }

    if (event.type === "turn.failed") {
      await rt.manager.emit({
        type: "error",
        message: `codex turn failed: ${event.error.message}`,
        agentId: rt.meta.id,
        ts: new Date().toISOString(),
        seq: 0,
      });
      throw new Error(event.error.message);
    }

    if (event.type === "error") {
      await rt.manager.emit({
        type: "error",
        message: event.message,
        agentId: rt.meta.id,
        ts: new Date().toISOString(),
        seq: 0,
      });
      throw new Error(event.message);
    }

    // turn.started / turn.completed / thread.started — nothing for us
    // to forward; manager owns turn-start/turn-end emission.
  }
  } finally {
    // Keep `codex resume` / Codex Desktop's thread list clean — Reflex
    // owns its own conversational memory; the Codex-side rollout file
    // is ephemeral. Best-effort, doesn't affect the turn's outcome.
    await deleteCodexSession(thread.id);
  }
}
