"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { addRoot, getRoot, markInitialized, removeRoot } from "@/lib/registry";
import { runInit } from "@/lib/reflex/commands/init";
import { loadSettings } from "@/lib/settings/store";
import { createTopic } from "@/lib/server/topics";
import { startOrchestratorTurn } from "@/lib/server/agents/start-turn";
import { writeMemory, readMemoryFile } from "@/lib/server/memory/store";
import { MEMORY_FILES } from "@/lib/server/memory/types";

export interface AddRootResult {
  ok: boolean;
  id?: string;
  /**
   * Topic id of the auto-spawned onboarding chat. Caller should redirect
   * to `/roots/${id}/chat/${onboardingTopicId}` so the user lands right
   * in the wizard conversation.
   */
  onboardingTopicId?: string;
  error?: string;
}

export async function addRootAction(absPath: string): Promise<AddRootResult> {
  try {
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return { ok: false, error: `Not a directory: ${absPath}` };
    }
    const entry = await addRoot(absPath);
    revalidatePath("/");
    const onboardingTopicId = await spawnOnboardingTopic(entry).catch(
      () => undefined,
    );
    return {
      ok: true,
      id: entry.id,
      ...(onboardingTopicId ? { onboardingTopicId } : {}),
    };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

async function spawnOnboardingTopic(entry: {
  id: string;
  path: string;
}): Promise<string | undefined> {
  const settings = await loadSettings();
  const assignment = settings.assignments.chat;
  const firstMessage = "/skill space-onboarding";
  const topic = await createTopic({
    root: entry.path,
    firstMessage: "Space onboarding",
    harness: assignment.harness,
    model: assignment.model,
    language: settings.language,
  });
  const res = await startOrchestratorTurn({
    rootId: entry.id,
    topicId: topic.meta.id,
    message: firstMessage,
    attachments: [],
  });
  if ("error" in res) {
    // Topic created but agent didn't start — the user can still send a
    // message manually. Return the topicId so they land in it.
  }
  return topic.meta.id;
}

export interface RunInitResult {
  ok: boolean;
  error?: string;
}

export async function runInitAction(
  rootPath: string,
  rootIdValue: string,
  scaffoldOnly = false,
): Promise<RunInitResult> {
  try {
    const settings = await loadSettings();
    const analyze = settings.assignments.analyze;
    // Settings only knows about agentic harnesses for this task; if the user
    // somehow set a non-agentic one we fall back to per-root config.
    const harness =
      analyze.harness === "claude-code" || analyze.harness === "codex"
        ? analyze.harness
        : undefined;
    await runInit(rootPath, {
      scaffoldOnly,
      language: settings.language,
      ...(harness ? { harness } : {}),
      ...(harness ? { model: analyze.model } : {}),
    });
    if (!scaffoldOnly) await markInitialized(rootIdValue);
    revalidatePath("/");
    revalidatePath(`/roots/${rootIdValue}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export interface RemoveRootResult {
  ok: boolean;
  error?: string;
}

/**
 * Delete a Space:
 *   1. Wipe the project's `.reflex/` folder (Reflex state — KB, topics,
 *      memory, suggestions, layout, audit, journal). User files in the
 *      project directory itself are left alone.
 *   2. Scrub mentions of the project name / path from every GLOBAL
 *      memory file so the agent stops referencing a Space that no
 *      longer exists.
 *   3. Remove from the registry so it disappears from the sidebar / home.
 */
export async function removeRootAction(
  id: string,
): Promise<RemoveRootResult> {
  try {
    const entry = await getRoot(id);
    if (!entry) {
      // Already gone — treat as success.
      revalidatePath("/");
      return { ok: true };
    }
    const reflexDir = path.join(entry.path, ".reflex");
    await fs
      .rm(reflexDir, { recursive: true, force: true })
      .catch(() => null);

    const projectName = path.basename(entry.path);
    await scrubGlobalMemory({ projectName, projectPath: entry.path });

    await removeRoot(id);
    revalidatePath("/");
    revalidatePath(`/roots/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

async function scrubGlobalMemory(args: {
  projectName: string;
  projectPath: string;
}): Promise<void> {
  const tokens = new Set<string>();
  if (args.projectName.trim()) tokens.add(args.projectName.trim());
  if (args.projectPath.trim()) tokens.add(args.projectPath.trim());
  // Token-free name (no path) helps with relative mentions too.
  if (tokens.size === 0) return;
  for (const file of MEMORY_FILES) {
    const cur = await readMemoryFile({ scope: "global" }, file);
    if (!cur.content) continue;
    const kept = cur.content
      .split("\n")
      .filter((line) => {
        const lower = line.toLowerCase();
        for (const tok of tokens) {
          if (lower.includes(tok.toLowerCase())) return false;
        }
        return true;
      })
      .join("\n")
      .trim();
    if (kept === cur.content.trim()) continue; // nothing matched
    await writeMemory({ scope: "global" }, file, "replace", {
      content: kept,
    });
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    try {
      const parsed: unknown = JSON.parse(err.message);
      if (Array.isArray(parsed)) {
        return parsed
          .map((e) => {
            if (typeof e === "object" && e !== null && "message" in e) {
              return String((e as { message: unknown }).message);
            }
            return String(e);
          })
          .join("; ");
      }
    } catch {
      // not JSON
    }
    return err.message;
  }
  return String(err);
}
