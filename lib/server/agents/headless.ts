import "server-only";
import { agentManager } from "./manager";
import { startOrchestratorTurn } from "./start-turn";
import { readEvents } from "./events-log";
import { createTopic, deleteTopic } from "@/lib/server/topics";
import { loadSettings } from "@/lib/settings/store";
import { getRoot } from "@/lib/registry";

/**
 * "Headless" agent runner — spin up an ephemeral topic, run one full
 * orchestrator turn, harvest the final assistant text, then delete the
 * topic. Used by workflow `ask-agent` steps and by the utility host-API
 * `agent.invoke` method so external callers (utilities, workflows,
 * cron-triggered jobs) get the agent's reply as a plain string without
 * littering the sidebar.
 *
 * Errors from the agent (tool failures, prompt errors) bubble up as
 * exceptions; the caller decides how to surface them.
 */
export interface HeadlessAgentArgs {
  rootId: string;
  prompt: string;
  /** Origin label that ends up in the topic's first-message + logs. */
  label?: string;
  /** Override harness/model for this single run. Defaults from settings.chat. */
  harness?: string;
  model?: string;
  language?: string;
  /** Max wait before giving up (ms). Default 5 min — long enough for
   *  multi-step reasoning, short enough that a stuck agent surfaces. */
  timeoutMs?: number;
  /**
   * Optional file attachments — agent gets their paths in the user
   * message and uses its Read tool to open them. Images are returned
   * as native vision content by both Claude Code and Codex Read tools,
   * so this is the harness-agnostic way to do image-aware reasoning.
   */
  attachments?: import("./start-turn").Attachment[];
}

export interface HeadlessAgentResult {
  text: string;
  topicId: string;
  /** Best-effort: true if we hit the timeout before the agent went idle. */
  timedOut: boolean;
}

export async function runHeadlessAgent(
  args: HeadlessAgentArgs,
): Promise<HeadlessAgentResult> {
  const entry = await getRoot(args.rootId);
  if (!entry) throw new Error(`runHeadlessAgent: root not found: ${args.rootId}`);
  const settings = await loadSettings();
  const assignment = settings.assignments.chat;
  const topic = await createTopic({
    root: entry.path,
    firstMessage: args.label ?? "[headless agent run]",
    harness: args.harness ?? assignment.harness,
    model: args.model ?? assignment.model,
    language: args.language ?? settings.language,
  });
  let timedOut = false;
  try {
    const res = await startOrchestratorTurn({
      rootId: args.rootId,
      topicId: topic.meta.id,
      message: args.prompt,
      attachments: args.attachments ?? [],
      // Forward harness/model overrides so the orchestrator agent
      // actually runs on the requested runtime (e.g. Codex), not the
      // user's default chat assignment.
      ...(args.harness
        ? { harness: args.harness as import("./types").AgentHarnessId }
        : {}),
      ...(args.model ? { model: args.model } : {}),
    });
    if ("error" in res) {
      throw new Error(res.error);
    }
    const deadline = Date.now() + (args.timeoutMs ?? 5 * 60_000);
    // Give the orchestrator a beat to spin up — otherwise `isActive` can
    // return false before the turn has even registered, and we'd bail
    // immediately with an empty transcript.
    await sleep(400);
    while (Date.now() < deadline) {
      if (!agentManager.isActive(topic.meta.id)) break;
      await sleep(400);
    }
    if (agentManager.isActive(topic.meta.id)) {
      timedOut = true;
    }
    // Flush window: events.jsonl writes are async; turn-end may be on
    // disk but trailing assistant-delta still in-flight. 400ms covers
    // typical fs latency.
    await sleep(400);
    const events = await readEvents(entry.path, topic.meta.id);
    const text = events
      .filter(
        (e): e is Extract<typeof events[number], { type: "assistant-delta" }> =>
          e.type === "assistant-delta",
      )
      .map((e) => e.text)
      .join("")
      .trim();

    // Surface explicit failures: if the agent only emitted error/system
    // events and no assistant text, the caller deserves to see why
    // instead of "(empty)".
    if (!text) {
      const errors = events
        .filter(
          (e): e is Extract<typeof events[number], { type: "error" }> =>
            e.type === "error",
        )
        .map((e) => e.message)
        .filter(Boolean);
      if (errors.length > 0) {
        throw new Error(
          `Agent finished with errors: ${errors.slice(0, 3).join(" · ")}`,
        );
      }
      // Fallback: hand back the most recent `system` text if there's no
      // assistant-delta. Better than empty string — usually contains a
      // hint like "no model configured" or "turn aborted".
      const systems = events
        .filter(
          (e): e is Extract<typeof events[number], { type: "system" }> =>
            e.type === "system",
        )
        .map((e) => e.text)
        .filter(Boolean);
      if (systems.length > 0) {
        return {
          text: systems.join("\n"),
          topicId: topic.meta.id,
          timedOut,
        };
      }
      if (timedOut) {
        throw new Error(
          `Agent did not respond within ${Math.round((args.timeoutMs ?? 300_000) / 1000)}s (timeout)`,
        );
      }
      throw new Error(
        "Agent finished without producing any text — perhaps no chat engine is configured in Settings.",
      );
    }
    return { text, topicId: topic.meta.id, timedOut };
  } finally {
    try {
      await agentManager.stopTopic(topic.meta.id);
    } catch {
      /* ignore */
    }
    try {
      await deleteTopic(entry.path, topic.meta.id);
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
