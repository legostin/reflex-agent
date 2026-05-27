/**
 * Task data model — shared between server modules and the utility's
 * host-API contract. Tasks live as KB entries (`kind: "task"`); this
 * type just gives the frontmatter a stable shape.
 */

export const TASK_TYPES = [
  "feature",
  "bug",
  "refactor",
  "docs",
  "chore",
  "research",
  "review",
  "call",
  "idea",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  "backlog",
  "ready",
  "in-progress",
  "review",
  "done",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskWorktree {
  dir: string;
  branch: string;
  baseRef: string;
}

export interface TaskHookRef {
  kind: "workflow" | "chat";
  /** workflow id (for kind=workflow) */
  id?: string;
  /** chat prompt to prepend (for kind=chat) */
  prompt?: string;
}

export interface TaskAttachment {
  kind: "image" | "text" | "file";
  /** Path relative to <root>/.reflex/tasks/<taskId>/ */
  file: string;
  caption?: string;
}

export interface TaskLinks {
  blocks?: string[];
  blockedBy?: string[];
  related?: string[];
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  topicId: string | null;
  agentRequested: string | null;
  worktree: TaskWorktree | null;
  links: TaskLinks;
  parent: string | null;
  pre: TaskHookRef[];
  post: TaskHookRef[];
  attachments: TaskAttachment[];
  /** Path relative to <root>/.reflex/, set after persist. */
  relPath: string;
  /** Markdown body — description, criteria, notes. */
  body: string;
}

/**
 * Defaults seeded per task type when the user picks "feature"/"bug"/etc.
 * isCode drives worktree creation + PR mode availability.
 */
export const TYPE_DEFAULTS: Record<
  TaskType,
  { isCode: boolean; defaultSkill?: string }
> = {
  feature: { isCode: true },
  bug: { isCode: true, defaultSkill: "deep-research" },
  refactor: { isCode: true },
  docs: { isCode: true },
  chore: { isCode: true },
  research: { isCode: false, defaultSkill: "deep-research" },
  review: { isCode: true },
  call: { isCode: false },
  idea: { isCode: false },
};

export function isTaskType(s: string): s is TaskType {
  return (TASK_TYPES as readonly string[]).includes(s);
}

export function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

export function isTaskPriority(s: string): s is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(s);
}
