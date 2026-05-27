"use server";

import { revalidatePath } from "next/cache";
import { getRoot } from "@/lib/registry";
import {
  clearTopicGoal,
  createTopic,
  deleteTopic,
  listTopics,
  updateTopicTitle,
  type TopicSummary,
} from "./topics";
import { loadSettings } from "@/lib/settings/store";
import { quickComplete } from "./quick";
import { startOrchestratorTurn, type Attachment } from "./agents/start-turn";
import { agentManager } from "./agents/manager";

export type StartTopicResult =
  | { ok: true; topicId: string }
  | { ok: false; error: string };

export async function startTopicAction(
  rootId: string,
  prompt: string,
  attachments: Attachment[] = [],
  focusFile?: string,
): Promise<StartTopicResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    if (!prompt.trim() && attachments.length === 0) {
      return { ok: false, error: "Empty prompt" };
    }
    const settings = await loadSettings();
    const assignment = settings.assignments.chat;
    const seedTitle = prompt.trim() || attachments[0]?.name || "Untitled";
    const topic = await createTopic({
      root: entry.path,
      firstMessage: seedTitle,
      harness: assignment.harness,
      model: assignment.model,
      language: settings.language,
    });
    // Kick off the orchestrator's first turn. Fire-and-forget — the agent
    // streams into events.jsonl regardless of whether the client navigates
    // immediately or comes back later.
    const result = await startOrchestratorTurn({
      rootId,
      topicId: topic.meta.id,
      message: prompt.trim(),
      attachments,
      ...(focusFile ? { focusFile } : {}),
    });
    if ("error" in result) {
      return { ok: false, error: result.error };
    }
    revalidatePath(`/roots/${rootId}`);
    return { ok: true, topicId: topic.meta.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ListTopicsResult =
  | { ok: true; topics: TopicSummary[] }
  | { ok: false; error: string };

export async function listTopicsAction(
  rootId: string,
): Promise<ListTopicsResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const topics = await listTopics(entry.path);
    // Hide utility helper conversations — they're not user-authored
    // topics, they belong to the in-utility sidebar.
    const visible = topics.filter((t) => !t.meta.helperFor);
    return { ok: true, topics: visible };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type GenerateTitleResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

/**
 * Use the configured "quick" model to produce a tight topic title from the
 * user's first message. Updates the topic file frontmatter so future reads
 * see the new title, then returns it for an immediate UI update.
 */
export async function generateTopicTitleAction(
  rootId: string,
  topicId: string,
  firstMessage: string,
): Promise<GenerateTitleResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const settings = await loadSettings();
    const assignment = settings.assignments.quick;
    const lang = settings.language;
    const prompt = [
      `Write a short, descriptive title for the following user question.`,
      `Language: ${lang}.`,
      `Constraints:`,
      `  - 3 to 7 words`,
      `  - no quotes, no trailing punctuation`,
      `  - no leading prefixes like "Title:" — just the title text`,
      ``,
      `User question:`,
      firstMessage,
    ].join("\n");
    const raw = await quickComplete(assignment, prompt, { timeoutMs: 25_000 });
    const cleaned = cleanTitle(raw);
    if (!cleaned) return { ok: false, error: "Empty title from model" };
    await updateTopicTitle(entry.path, topicId, cleaned);
    revalidatePath(`/roots/${rootId}`);
    revalidatePath(`/roots/${rootId}/chat/${topicId}`);
    return { ok: true, title: cleaned };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hard-delete a topic: stop any agent running on it, then unlink both the
 * `.md` and the `.events.jsonl`. Used by the sidebar trash button and the
 * chat-header "Delete topic" action.
 */
export async function deleteTopicAction(
  rootId: string,
  topicId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    // Stop first — if an agent is mid-turn it would otherwise keep emitting
    // events into the file we're about to delete and immediately recreate
    // it. stopTopic is idempotent (no-op when nothing is running).
    await agentManager.stopTopic(topicId);
    await deleteTopic(entry.path, topicId);
    revalidatePath(`/roots/${rootId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function clearTopicGoalAction(
  rootId: string,
  topicId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    await clearTopicGoal(entry.path, topicId, "abandoned");
    revalidatePath(`/roots/${rootId}/chat/${topicId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface HelperTranscriptMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts: string;
}

/**
 * Lightweight transcript loader for the utility helper sidebar. Reads
 * the topic's `events.jsonl` and projects to a flat list of user +
 * assistant messages (no tool-use cards, no permission cards — those
 * make sense in the full chat view but clutter a compact sidebar).
 * Strips `<<reflex:…>>` protocol markers before returning.
 */
export async function loadHelperTranscriptAction(
  rootId: string,
  topicId: string,
): Promise<{
  ok: true;
  messages: HelperTranscriptMessage[];
} | { ok: false; error: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const { readEvents } = await import("./agents/events-log");
    const events = await readEvents(entry.path, topicId);
    const messages: HelperTranscriptMessage[] = [];
    // Group assistant deltas by agent — adjacent deltas concatenate into
    // a single bubble.
    let currentAssistant: { text: string; ts: string } | null = null;
    const flush = () => {
      if (currentAssistant && currentAssistant.text.trim()) {
        messages.push({
          role: "assistant",
          text: stripReflexMarkers(currentAssistant.text).trim(),
          ts: currentAssistant.ts,
        });
      }
      currentAssistant = null;
    };
    for (const e of events) {
      if (e.type === "user-message") {
        flush();
        if (
          typeof e.text === "string" &&
          e.text.trim() &&
          // Skip the synthetic seed firstMessage we wrote when creating the topic.
          !e.text.startsWith("[Helper ·")
        ) {
          messages.push({ role: "user", text: e.text, ts: e.ts });
        }
      } else if (e.type === "assistant-delta") {
        if (!currentAssistant) {
          currentAssistant = { text: "", ts: e.ts };
        }
        currentAssistant.text += e.text;
      } else if (e.type === "turn-end" || e.type === "agent-end") {
        flush();
      }
    }
    flush();
    return { ok: true, messages };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function stripReflexMarkers(text: string): string {
  const tags = [
    "permission",
    "question",
    "kb",
    "utility",
    "dispatch",
    "mcp-add",
    "youtube-summary",
    "widget-create",
    "widget-update",
    "workflow-create",
    "image-gen",
  ];
  let out = text;
  for (const t of tags) {
    out = out.replace(
      new RegExp(
        `<{1,2}reflex:${t}>{1,2}[\\s\\S]*?<{1,2}\\/reflex:${t}>{1,2}`,
        "g",
      ),
      "",
    );
  }
  return out;
}

/**
 * Find (or create) a dedicated helper topic for a utility. Search keys
 * on `meta.helperFor === utilityId`. Caller passes utility name for the
 * topic title (so the topic looks recognizable if it ever leaks into
 * the regular Topics list).
 *
 * No first turn is fired here — the sidebar drives turns via the
 * standard /send endpoint once the user types something.
 */
export async function getOrCreateUtilityHelperTopicAction(args: {
  rootId: string;
  utilityId: string;
  utilityName: string;
}): Promise<
  | { ok: true; topicId: string; created: boolean }
  | { ok: false; error: string }
> {
  try {
    const entry = await getRoot(args.rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const all = await listTopics(entry.path);
    const existing = all.find((t) => t.meta.helperFor === args.utilityId);
    if (existing) {
      return { ok: true, topicId: existing.meta.id, created: false };
    }
    const settings = await loadSettings();
    const assignment = settings.assignments.chat;
    const topic = await createTopic({
      root: entry.path,
      firstMessage: `[Helper · ${args.utilityName}]`,
      harness: assignment.harness,
      model: assignment.model,
      language: settings.language,
      helperFor: args.utilityId,
    });
    return { ok: true, topicId: topic.meta.id, created: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function cleanTitle(s: string): string {
  // Strip code fences, quotes, leading "Title:" and trailing punctuation.
  let t = s.trim();
  t = t.replace(/^```[a-z]*\s*([\s\S]*?)\s*```$/i, "$1");
  t = t.replace(/^['"«»“”‘’`]+|['"«»“”‘’`]+$/g, "");
  t = t.replace(/^\s*title\s*:\s*/i, "");
  t = t.split(/\r?\n/)[0]?.trim() ?? "";
  t = t.replace(/[.!?…]+$/u, "").trim();
  if (t.length > 80) t = t.slice(0, 77).trimEnd() + "…";
  return t;
}
