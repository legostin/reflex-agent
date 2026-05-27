import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import { reflexRoot } from "@/lib/reflex/paths";
import { listKbFiles } from "@/lib/server/kb";
import {
  TASK_TYPES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Task,
  type TaskHookRef,
  type TaskAttachment,
  type TaskLinks,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  type TaskWorktree,
} from "./types";

/**
 * Tasks persist as KB entries (`kind: "task"`) at
 * `<root>/.reflex/task/<date>-<slug>.md`. Frontmatter holds the
 * structured fields; the body is freeform markdown — description,
 * criteria, notes. The utility owns presentation; this module owns
 * the source of truth.
 */

const TASK_KIND = "task";

export interface CreateTaskInput {
  title: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  body?: string;
  labels?: string[];
  assignee?: string | null;
  parent?: string | null;
  links?: TaskLinks;
  pre?: TaskHookRef[];
  post?: TaskHookRef[];
  attachments?: TaskAttachment[];
}

export async function createTask(
  rootPath: string,
  input: CreateTaskInput,
): Promise<Task> {
  const id = `t-${crypto.randomBytes(4).toString("hex")}`;
  const slug = slugify(input.title) || id;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${today}-${slug}.md`;
  const dir = path.join(reflexRoot(rootPath), TASK_KIND);
  await fs.mkdir(dir, { recursive: true });
  const abs = await uniquePath(dir, filename);

  const task: Task = {
    id,
    title: input.title.trim(),
    type: input.type ?? "feature",
    status: input.status ?? "backlog",
    priority: input.priority ?? "normal",
    labels: input.labels ?? [],
    assignee: input.assignee ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    topicId: null,
    agentRequested: null,
    worktree: null,
    links: input.links ?? {},
    parent: input.parent ?? null,
    pre: input.pre ?? [],
    post: input.post ?? [],
    attachments: input.attachments ?? [],
    relPath: path
      .relative(reflexRoot(rootPath), abs)
      .split(path.sep)
      .join("/"),
    body: (input.body ?? "").trim(),
  };
  await writeTaskFile(abs, task);
  return task;
}

export async function listTasks(rootPath: string): Promise<Task[]> {
  const all = await listKbFiles(rootPath).catch(() => []);
  const tasks: Task[] = [];
  for (const f of all) {
    if (f.meta.kind !== TASK_KIND) continue;
    const parsed = await readTaskFile(f.abs, rootPath).catch(() => null);
    if (parsed) tasks.push(parsed);
  }
  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return tasks;
}

export async function getTask(
  rootPath: string,
  id: string,
): Promise<Task | null> {
  const all = await listTasks(rootPath);
  return all.find((t) => t.id === id) ?? null;
}

export async function updateTask(
  rootPath: string,
  id: string,
  patch: Partial<
    Pick<
      Task,
      | "title"
      | "type"
      | "status"
      | "priority"
      | "labels"
      | "assignee"
      | "topicId"
      | "agentRequested"
      | "worktree"
      | "links"
      | "parent"
      | "pre"
      | "post"
      | "attachments"
      | "body"
    >
  >,
): Promise<Task | null> {
  const cur = await getTask(rootPath, id);
  if (!cur) return null;
  const abs = path.join(reflexRoot(rootPath), cur.relPath);
  const next: Task = {
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeTaskFile(abs, next);
  return next;
}

export async function deleteTask(
  rootPath: string,
  id: string,
): Promise<boolean> {
  const cur = await getTask(rootPath, id);
  if (!cur) return false;
  const abs = path.join(reflexRoot(rootPath), cur.relPath);
  await fs.rm(abs, { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Internals

async function readTaskFile(abs: string, rootPath: string): Promise<Task | null> {
  const raw = await fs.readFile(abs, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const id = typeof fm.id === "string" ? fm.id : null;
  const title = typeof fm.title === "string" ? fm.title : null;
  if (!id || !title) return null;
  const rel = path
    .relative(reflexRoot(rootPath), abs)
    .split(path.sep)
    .join("/");
  return {
    id,
    title,
    type: pickEnum(fm.type, TASK_TYPES, "feature"),
    status: pickEnum(fm.status, TASK_STATUSES, "backlog"),
    priority: pickEnum(fm.priority, TASK_PRIORITIES, "normal"),
    labels: Array.isArray(fm.labels) ? fm.labels.map(String) : [],
    assignee: typeof fm.assignee === "string" ? fm.assignee : null,
    createdAt:
      typeof fm.createdAt === "string" ? fm.createdAt : new Date().toISOString(),
    updatedAt:
      typeof fm.updatedAt === "string" ? fm.updatedAt : new Date().toISOString(),
    topicId: typeof fm.topicId === "string" ? fm.topicId : null,
    agentRequested:
      typeof fm.agentRequested === "string" ? fm.agentRequested : null,
    worktree: pickWorktree(fm.worktree),
    links: pickLinks(fm.links),
    parent: typeof fm.parent === "string" ? fm.parent : null,
    pre: pickHooks(fm.pre),
    post: pickHooks(fm.post),
    attachments: pickAttachments(fm.attachments),
    relPath: rel,
    body: parsed.content.trim(),
  };
}

async function writeTaskFile(abs: string, task: Task): Promise<void> {
  const fm: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    kind: TASK_KIND,
    type: task.type,
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    assignee: task.assignee,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    topicId: task.topicId,
    agentRequested: task.agentRequested,
    worktree: task.worktree,
    links: task.links,
    parent: task.parent,
    pre: task.pre,
    post: task.post,
    attachments: task.attachments,
  };
  const body = task.body.trim();
  const content = matter.stringify(body ? body + "\n" : "", fm);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function uniquePath(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  let candidate = path.join(dir, baseName);
  let i = 2;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
    i++;
  }
  return candidate;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pickEnum<T extends readonly string[]>(
  v: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : fallback;
}

function pickWorktree(v: unknown): TaskWorktree | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.dir === "string" &&
    typeof o.branch === "string" &&
    typeof o.baseRef === "string"
  ) {
    return { dir: o.dir, branch: o.branch, baseRef: o.baseRef };
  }
  return null;
}

function pickLinks(v: unknown): TaskLinks {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    ...(Array.isArray(o.blocks) ? { blocks: o.blocks.map(String) } : {}),
    ...(Array.isArray(o.blockedBy)
      ? { blockedBy: o.blockedBy.map(String) }
      : {}),
    ...(Array.isArray(o.related) ? { related: o.related.map(String) } : {}),
  };
}

function pickHooks(v: unknown): TaskHookRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): TaskHookRef | null => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      if (o.kind === "workflow" && typeof o.id === "string") {
        return { kind: "workflow", id: o.id };
      }
      if (o.kind === "chat" && typeof o.prompt === "string") {
        return { kind: "chat", prompt: o.prompt };
      }
      return null;
    })
    .filter((x): x is TaskHookRef => !!x);
}

function pickAttachments(v: unknown): TaskAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): TaskAttachment | null => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const kind = o.kind;
      if (kind !== "image" && kind !== "text" && kind !== "file") return null;
      if (typeof o.file !== "string") return null;
      return {
        kind,
        file: o.file,
        ...(typeof o.caption === "string" ? { caption: o.caption } : {}),
      };
    })
    .filter((x): x is TaskAttachment => !!x);
}
