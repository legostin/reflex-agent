import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listKbFiles } from "./kb";
import { listTopics } from "./topics";
import { agentManager } from "./agents/manager";
import { listPendingForRoot } from "./agents/pending-interactions";
import { quickComplete } from "./quick";
import { loadSettings } from "@/lib/settings/store";
import { getRoot } from "@/lib/registry";

/**
 * AI-driven "what's next" suggestions for a project. On-demand only (the
 * dashboard has a "Пересчитать" button). Results are cached per-root at
 * `~/.reflex/roots/<rootId>/suggestions.json` (mode 0600). Stale after 24h
 * but still served — UI renders a "устарело" badge instead of auto-firing.
 *
 * Uses the user-configured `quick` assignment (Settings → Assignments), so
 * suggestions run through whatever harness/model the user picked for cheap
 * one-shot tasks (title gen, labels, etc). No Gemini lock-in.
 *
 * Failure modes degrade transparently: network 5xx, parse error all
 * surface to the caller, which decides whether to retry or show a hint.
 */

export type SuggestionActionKind =
  | "open-topic"
  | "open-kb"
  | "send-message"
  | "none";

export interface SuggestionAction {
  kind: SuggestionActionKind;
  /** topicId for open-topic, rel-path for open-kb, text payload for send-message. */
  target?: string;
  /** Topic id to send into when kind === "send-message". */
  topicId?: string;
  label: string;
}

export interface SuggestionItem {
  title: string;
  why: string;
  action: SuggestionAction;
}

export interface SuggestionsCache {
  rootId: string;
  generatedAt: string;
  model: string;
  items: SuggestionItem[];
}

const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile(rootId: string): string {
  const safe = rootId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(os.homedir(), ".reflex", "roots", safe, "suggestions.json");
}

export async function readSuggestionsCache(
  rootId: string,
): Promise<SuggestionsCache | null> {
  try {
    const raw = await fs.readFile(cacheFile(rootId), "utf8");
    const parsed = JSON.parse(raw) as SuggestionsCache;
    if (parsed.rootId !== rootId) return null;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isFresh(cache: SuggestionsCache | null): boolean {
  if (!cache) return false;
  const age = Date.now() - Date.parse(cache.generatedAt);
  return Number.isFinite(age) && age >= 0 && age < FRESH_TTL_MS;
}

async function writeCache(cache: SuggestionsCache): Promise<void> {
  const file = cacheFile(cache.rootId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cache, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    /* best effort */
  }
}

export async function regenerateSuggestions(
  rootId: string,
): Promise<
  | { ok: true; cache: SuggestionsCache }
  | { ok: false; needsKey?: true; error: string }
> {
  const entry = await getRoot(rootId);
  if (!entry) return { ok: false, error: "Root not found" };
  const settings = await loadSettings();
  const assignment = settings.assignments.quick;
  const snapshot = await buildStateSnapshot(rootId, entry.path);
  if (snapshot.empty) {
    const cache: SuggestionsCache = {
      rootId,
      generatedAt: new Date().toISOString(),
      model: "n/a",
      items: [
        {
          title: "Проект пуст",
          why: "Нет тем, нет KB-файлов — нечего предлагать. Начни с /chat или создай первую запись.",
          action: { kind: "none", label: "OK" },
        },
      ],
    };
    await writeCache(cache);
    return { ok: true, cache };
  }
  const prompt = buildPrompt(snapshot);
  try {
    const text = await quickComplete(assignment, prompt, { timeoutMs: 45_000 });
    const items = parseSuggestionsJson(text);
    const cache: SuggestionsCache = {
      rootId,
      generatedAt: new Date().toISOString(),
      model: `${assignment.harness}:${assignment.model}`,
      items: items.slice(0, 5),
    };
    await writeCache(cache);
    return { ok: true, cache };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface StateSnapshot {
  empty: boolean;
  topicCount: number;
  topicsWithGoal: Array<{
    id: string;
    title: string;
    goal: string;
    iterations: number;
    updatedAt: string;
    running: boolean;
  }>;
  runningTopics: Array<{ id: string; title: string }>;
  recentKb: Array<{ rel: string; title: string; modifiedAt: string }>;
  pendingCount: number;
  totalKbFiles: number;
  staleTopics: Array<{ id: string; title: string; updatedAt: string }>;
}

async function buildStateSnapshot(
  rootId: string,
  rootPath: string,
): Promise<StateSnapshot> {
  const [topics, kbFiles] = await Promise.all([
    listTopics(rootPath),
    listKbFiles(rootPath),
  ]);
  const topicIds = topics.map((t) => t.meta.id);
  const runningIds = new Set(
    typeof agentManager.listRunningTopicsForRoot === "function"
      ? agentManager.listRunningTopicsForRoot(rootId)
      : [],
  );
  const pending = await listPendingForRoot(rootPath, topicIds);
  const cutoffStale = Date.now() - 5 * 24 * 60 * 60 * 1000; // 5 days
  const staleTopics = topics
    .filter((t) => Date.parse(t.meta.updatedAt) < cutoffStale)
    .filter(
      (t) =>
        t.meta.goal && t.meta.goalStatus === "active",
    )
    .map((t) => ({
      id: t.meta.id,
      title: t.meta.title,
      updatedAt: t.meta.updatedAt,
    }));
  return {
    empty: topics.length === 0 && kbFiles.length === 0,
    topicCount: topics.length,
    topicsWithGoal: topics
      .filter((t) => t.meta.goal && t.meta.goalStatus === "active")
      .map((t) => ({
        id: t.meta.id,
        title: t.meta.title,
        goal: t.meta.goal!,
        iterations: t.meta.goalIterations ?? 0,
        updatedAt: t.meta.updatedAt,
        running: runningIds.has(t.meta.id),
      })),
    runningTopics: topics
      .filter((t) => runningIds.has(t.meta.id))
      .map((t) => ({ id: t.meta.id, title: t.meta.title })),
    recentKb: kbFiles
      .slice()
      .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
      .slice(0, 8)
      .map((f) => ({
        rel: f.rel,
        title: f.meta.title ?? f.rel,
        modifiedAt: f.modifiedAt,
      })),
    pendingCount: pending.length,
    totalKbFiles: kbFiles.length,
    staleTopics,
  };
}

function buildPrompt(s: StateSnapshot): string {
  return [
    "You analyse the state of a local Reflex knowledge-base project and propose 2–4 high-leverage actions for the user.",
    "Output STRICT JSON: an object with one key `items`, value array of {title, why, action}.",
    "action.kind ∈ {\"open-topic\", \"open-kb\", \"send-message\", \"none\"}.",
    "  - open-topic: target = topic id from the snapshot",
    "  - open-kb: target = rel-path from the snapshot (.reflex/-relative)",
    "  - send-message: target = the literal text Reflex should send. topicId = which topic to send into (use an existing id from the snapshot or omit for new chat).",
    "  - none: informational only",
    "Each action.label is the button text (3-6 words, Russian or English to match the project's vibe).",
    "Each `title` is 4-9 words; each `why` is one sentence explaining the trigger.",
    "Skip trivialities. Don't propose chores that don't move the project forward.",
    "Reply in Russian unless titles/paths are obviously English.",
    "",
    "## Snapshot",
    JSON.stringify(s, null, 2),
    "",
    "Return only the JSON object — no preamble, no markdown fences, no comments. The reply MUST start with `{` and end with `}`.",
  ].join("\n");
}

function parseSuggestionsJson(text: string): SuggestionItem[] {
  // Quick-models (claude/codex/ollama) sometimes wrap JSON in ```json fences,
  // prepend a "Here's the JSON:" preamble, or trail with a closing remark.
  // Be tolerant: strip fences, then carve out the first {...} block.
  let payload = text.trim();
  if (payload.startsWith("```")) {
    payload = payload.replace(/^```[a-z]*\r?\n/i, "").replace(/```\s*$/i, "");
  }
  // Carve out the outermost JSON object — find first `{` and matching `}`.
  const firstBrace = payload.indexOf("{");
  const lastBrace = payload.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    payload = payload.slice(firstBrace, lastBrace + 1);
  }
  const parsed = JSON.parse(payload) as { items?: unknown };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    throw new Error("Модель вернула не-JSON или без items[]");
  }
  const items: SuggestionItem[] = [];
  for (const raw of parsed.items as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : null;
    const why = typeof r.why === "string" ? r.why : null;
    const action = r.action && typeof r.action === "object" ? (r.action as Record<string, unknown>) : null;
    if (!title || !why || !action) continue;
    const kind = action.kind;
    if (
      kind !== "open-topic" &&
      kind !== "open-kb" &&
      kind !== "send-message" &&
      kind !== "none"
    )
      continue;
    const label = typeof action.label === "string" ? action.label : "Открыть";
    items.push({
      title,
      why,
      action: {
        kind,
        label,
        ...(typeof action.target === "string" ? { target: action.target } : {}),
        ...(typeof action.topicId === "string" ? { topicId: action.topicId } : {}),
      },
    });
  }
  return items;
}
