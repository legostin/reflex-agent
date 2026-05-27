import "server-only";
import { getRoot } from "@/lib/registry";
import { loadSettings } from "@/lib/settings/store";
import { createTopic } from "@/lib/server/topics";
import { startOrchestratorTurn } from "@/lib/server/agents/start-turn";
import { runWorkflow } from "@/lib/server/workflows/runner";
import { getTask, updateTask } from "./store";
import {
  createWorktree,
  defaultBranch,
  isGitRepo,
} from "./worktree";
import { TYPE_DEFAULTS, type Task, type TaskHookRef } from "./types";

/**
 * Dispatch a task to an agent.
 *
 * Steps:
 *   1. Resolve task; refuse if status is already in-progress.
 *   2. If the type is `isCode` and the project is a git repo, create
 *      a worktree on `task/<slug-of-title>`.
 *   3. Run `pre` hooks (workflow + chat) — workflow outputs and chat
 *      prompts are gathered into a context blob fed to the agent.
 *   4. Build the agent's first message from title + body + pre output.
 *   5. createTopic with `taskId` + harness/model from settings/override.
 *   6. startOrchestratorTurn pointing at the worktree (or project root
 *      if no worktree).
 *   7. Persist topicId + worktree + status="in-progress" on the task.
 *
 * Returns the bound topic id + worktree info (if created).
 */

export interface DispatchTaskResult {
  ok: true;
  taskId: string;
  topicId: string;
  worktree?: { dir: string; branch: string };
}

export interface DispatchTaskError {
  ok: false;
  error: string;
}

export async function dispatchTask(args: {
  rootId: string;
  taskId: string;
  /** Override the harness Reflex would otherwise pick from settings.assignments.chat. */
  harness?: string;
  /** Override the model. */
  model?: string;
}): Promise<DispatchTaskResult | DispatchTaskError> {
  const entry = await getRoot(args.rootId);
  if (!entry) return { ok: false, error: "root not found" };
  const task = await getTask(entry.path, args.taskId);
  if (!task) return { ok: false, error: "task not found" };
  if (task.status === "in-progress") {
    return {
      ok: false,
      error: "task already dispatched (topic " + task.topicId + ")",
    };
  }

  const defaults = TYPE_DEFAULTS[task.type];
  const settings = await loadSettings();
  const assignment = settings.assignments.chat;
  const harness = args.harness ?? task.agentRequested ?? assignment.harness;
  const model = args.model ?? assignment.model;

  // --- worktree --------------------------------------------------
  let worktree = task.worktree;
  if (defaults.isCode && !worktree && (await isGitRepo(entry.path))) {
    try {
      const branch = `task/${slugForBranch(task.title) || task.id}`;
      const baseRef = await defaultBranch(entry.path);
      worktree = await createWorktree({
        rootPath: entry.path,
        slug: task.id,
        branch,
        baseRef,
      });
    } catch (err) {
      return {
        ok: false,
        error:
          "worktree create failed: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  // --- pre hooks -------------------------------------------------
  const preBlocks: string[] = [];
  for (const hook of task.pre) {
    const out = await runHook(args.rootId, hook);
    if (out) preBlocks.push(out);
  }

  // --- agent prompt ----------------------------------------------
  const skillPreamble = defaults.defaultSkill
    ? `/skill ${defaults.defaultSkill}\n\n`
    : "";
  const promptParts: string[] = [
    `${skillPreamble}You are now working on task ${task.id}: "${task.title}".`,
    "",
    "## Task description",
    task.body || "(no description)",
  ];
  if (preBlocks.length > 0) {
    promptParts.push("", "## Pre-task context (from hooks)", ...preBlocks);
  }
  if (worktree) {
    promptParts.push(
      "",
      `## Working directory`,
      `You are inside a git worktree at \`${worktree.dir}\` on branch \`${worktree.branch}\`. Commit changes here; main branch is untouched until the user clicks Merge.`,
    );
  }
  promptParts.push(
    "",
    "When done, mark the task as `done` via `<<reflex:task-update>>{\"id\":\"" +
      task.id +
      "\",\"status\":\"done\"}<</reflex:task-update>>`.",
  );
  const firstMessage = promptParts.join("\n");

  // --- topic + first turn ----------------------------------------
  const workingRoot = worktree?.dir ?? entry.path;
  const topic = await createTopic({
    root: workingRoot,
    firstMessage: task.title,
    harness,
    model,
    language: settings.language,
    taskId: task.id,
  });

  const turnRes = await startOrchestratorTurn({
    rootId: args.rootId,
    topicId: topic.meta.id,
    message: firstMessage,
    attachments: [],
  });
  if ("error" in turnRes) {
    return { ok: false, error: turnRes.error };
  }

  // --- persist on task -------------------------------------------
  await updateTask(entry.path, task.id, {
    topicId: topic.meta.id,
    agentRequested: harness,
    worktree,
    status: "in-progress",
  });

  return {
    ok: true,
    taskId: task.id,
    topicId: topic.meta.id,
    ...(worktree ? { worktree: { dir: worktree.dir, branch: worktree.branch } } : {}),
  };
}

async function runHook(
  rootId: string,
  hook: TaskHookRef,
): Promise<string | null> {
  if (hook.kind === "chat") {
    return hook.prompt ?? null;
  }
  if (hook.kind === "workflow" && hook.id) {
    try {
      const res = await runWorkflow(rootId, hook.id);
      if (!res.ok) return null;
      const lines: string[] = [];
      for (const step of res.run.steps) {
        const out = step.output;
        if (out === undefined || out === null) continue;
        lines.push(
          typeof out === "string" ? out : JSON.stringify(out, null, 2),
        );
      }
      const joined = lines.join("\n\n").trim();
      return joined ? `### workflow:${hook.id}\n${joined}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

function slugForBranch(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Used by manager.ts at task topic turn-end to run post hooks. */
export async function runPostHooks(args: {
  rootId: string;
  task: Task;
}): Promise<void> {
  for (const hook of args.task.post) {
    await runHook(args.rootId, hook).catch(() => null);
  }
}
