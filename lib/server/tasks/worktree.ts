import "server-only";
import { execa, type Options as ExecaOptions } from "execa";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Thin wrappers over `git worktree` so the task-board utility can run
 * each code-task in its own checkout without colliding on files.
 *
 * Layout for a task with id `t-5`:
 *
 *   <project>/                          ← main checkout
 *     .reflex/
 *       worktrees/
 *         t-5/                          ← worktree dir (branch task/<slug>)
 *           .reflex/
 *             memory → ../../../memory  ← symlink so the agent sees the
 *                                          same global+project memory in
 *                                          every worktree
 *
 * `.reflex/worktrees/` is added to `.reflexignore` on first create so
 * worktree contents don't pollute KB scans.
 */

export interface WorktreeInfo {
  dir: string;
  branch: string;
  baseRef: string;
}

export interface WorktreeListEntry {
  dir: string;
  branch?: string;
  head: string;
  detached: boolean;
  bare: boolean;
  isMain: boolean;
}

const WORKTREES_SUBDIR = path.join(".reflex", "worktrees");
const REFLEXIGNORE_ENTRY = ".reflex/worktrees/";

const GIT_TIMEOUT_MS = 30_000;

function gitOpts(rootPath: string): ExecaOptions {
  return { cwd: rootPath, timeout: GIT_TIMEOUT_MS, reject: false };
}

async function git(
  rootPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const res = await execa("git", args, gitOpts(rootPath));
  return {
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    code: typeof res.exitCode === "number" ? res.exitCode : 1,
  };
}

/**
 * `git -C <root> rev-parse --is-inside-work-tree` returns "true" inside
 * a non-bare repo. We use that rather than checking for `.git/` because
 * worktrees themselves have a `.git` file (not directory) pointing at
 * the main checkout.
 */
export async function isGitRepo(rootPath: string): Promise<boolean> {
  const res = await git(rootPath, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  return res.code === 0 && res.stdout.trim() === "true";
}

/**
 * Default branch detection — `git symbolic-ref refs/remotes/origin/HEAD`
 * first (the canonical "what's main on the remote"), then a fallback
 * to whatever branch HEAD currently points at.
 */
export async function defaultBranch(rootPath: string): Promise<string> {
  const ref = await git(rootPath, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (ref.code === 0 && ref.stdout.trim()) {
    // "origin/main" → "main"
    return ref.stdout.trim().replace(/^origin\//, "");
  }
  const head = await git(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return head.stdout.trim() || "main";
}

export async function hasRemote(rootPath: string): Promise<boolean> {
  const res = await git(rootPath, ["remote"]);
  if (res.code !== 0) return false;
  return res.stdout.trim().length > 0;
}

export async function hasGhCli(): Promise<boolean> {
  const res = await execa("gh", ["--version"], {
    timeout: 5_000,
    reject: false,
  });
  return typeof res.exitCode === "number" && res.exitCode === 0;
}

/**
 * Create a worktree at `<root>/.reflex/worktrees/<slug>` on a fresh
 * branch from `baseRef` (default branch if omitted). Errors thrown when:
 * - rootPath is not a git repo
 * - the destination already exists
 * - the branch already exists
 *
 * Memory dir is symlinked back to the main repo so global+project
 * memory is shared across worktrees.
 */
export async function createWorktree(args: {
  rootPath: string;
  slug: string;
  branch: string;
  baseRef?: string;
}): Promise<WorktreeInfo> {
  if (!(await isGitRepo(args.rootPath))) {
    throw new Error("createWorktree: project root is not a git repo");
  }

  const dir = path.join(args.rootPath, WORKTREES_SUBDIR, args.slug);
  const baseRef = args.baseRef ?? (await defaultBranch(args.rootPath));

  // Refuse if the destination already exists — caller decides whether to
  // remove the stale one before retrying.
  try {
    await fs.stat(dir);
    throw new Error(`createWorktree: ${dir} already exists`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Refuse if the branch already exists — same reason.
  const branchCheck = await git(args.rootPath, [
    "rev-parse",
    "--verify",
    `refs/heads/${args.branch}`,
  ]);
  if (branchCheck.code === 0) {
    throw new Error(
      `createWorktree: branch ${args.branch} already exists; remove it first`,
    );
  }

  await fs.mkdir(path.dirname(dir), { recursive: true });

  const add = await git(args.rootPath, [
    "worktree",
    "add",
    "-b",
    args.branch,
    dir,
    baseRef,
  ]);
  if (add.code !== 0) {
    throw new Error(
      `git worktree add failed (${add.code}): ${add.stderr.trim() || add.stdout.trim()}`,
    );
  }

  await ensureMemorySymlink(args.rootPath, dir);
  await ensureReflexignoreEntry(args.rootPath);

  return { dir, branch: args.branch, baseRef };
}

/**
 * Merge a worktree's branch back into `baseRef` (or default branch).
 * Returns `{ ok: false, conflicts }` on merge conflict — the worktree
 * is left intact so the user can resolve.
 */
export async function mergeWorktree(args: {
  rootPath: string;
  branch: string;
  intoRef?: string;
  noFf?: boolean;
}): Promise<
  | { ok: true; mergedInto: string }
  | { ok: false; conflicts: string[]; error: string }
> {
  const intoRef = args.intoRef ?? (await defaultBranch(args.rootPath));
  const current = await git(args.rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const previousBranch = current.stdout.trim();

  // Switch the main checkout to the target branch before merging.
  const checkout = await git(args.rootPath, ["checkout", intoRef]);
  if (checkout.code !== 0) {
    return {
      ok: false,
      conflicts: [],
      error: `checkout ${intoRef} failed: ${checkout.stderr.trim()}`,
    };
  }

  const flags = args.noFf === false ? [] : ["--no-ff"];
  const merge = await git(args.rootPath, ["merge", ...flags, args.branch]);
  if (merge.code !== 0) {
    // Read conflict files for the caller.
    const conflicts = await listConflicts(args.rootPath);
    return {
      ok: false,
      conflicts,
      error: merge.stderr.trim() || merge.stdout.trim() || "merge failed",
    };
  }

  // Best-effort return to whatever branch was checked out before.
  if (previousBranch && previousBranch !== intoRef) {
    await git(args.rootPath, ["checkout", previousBranch]);
  }

  return { ok: true, mergedInto: intoRef };
}

async function listConflicts(rootPath: string): Promise<string[]> {
  const res = await git(rootPath, ["diff", "--name-only", "--diff-filter=U"]);
  if (res.code !== 0) return [];
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Remove a worktree + (optionally) its branch. `force=true` skips git's
 * "uncommitted changes" guard — used by manual prune.
 */
export async function removeWorktree(args: {
  rootPath: string;
  slug: string;
  branch: string;
  force?: boolean;
  deleteBranch?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dir = path.join(args.rootPath, WORKTREES_SUBDIR, args.slug);
  const flags = args.force ? ["--force"] : [];
  const rm = await git(args.rootPath, ["worktree", "remove", ...flags, dir]);
  if (rm.code !== 0) {
    // If git refused but the dir is already gone, treat as success.
    try {
      await fs.stat(dir);
      return {
        ok: false,
        error: rm.stderr.trim() || rm.stdout.trim() || "worktree remove failed",
      };
    } catch {
      // dir gone — fall through to branch cleanup
    }
  }
  if (args.deleteBranch ?? true) {
    const delFlag = args.force ? "-D" : "-d";
    await git(args.rootPath, ["branch", delFlag, args.branch]);
    // Branch delete failures are non-fatal — the worktree is what we
    // really care about. A leftover branch can be cleaned manually.
  }
  // Best-effort prune to clean up dangling worktree metadata.
  await git(args.rootPath, ["worktree", "prune"]);
  return { ok: true };
}

/**
 * Parse `git worktree list --porcelain` into structured entries.
 */
export async function listWorktrees(
  rootPath: string,
): Promise<WorktreeListEntry[]> {
  const res = await git(rootPath, ["worktree", "list", "--porcelain"]);
  if (res.code !== 0) return [];
  const out: WorktreeListEntry[] = [];
  let cur: Partial<WorktreeListEntry> | null = null;
  for (const rawLine of res.stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (cur?.dir) out.push(finaliseEntry(cur, rootPath));
      cur = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (cur?.dir) out.push(finaliseEntry(cur, rootPath));
      cur = { dir: line.slice("worktree ".length) };
    } else if (cur) {
      if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch refs/heads/"))
        cur.branch = line.slice("branch refs/heads/".length);
      else if (line === "detached") cur.detached = true;
      else if (line === "bare") cur.bare = true;
    }
  }
  if (cur?.dir) out.push(finaliseEntry(cur, rootPath));
  return out;
}

function finaliseEntry(
  partial: Partial<WorktreeListEntry>,
  rootPath: string,
): WorktreeListEntry {
  return {
    dir: partial.dir!,
    ...(partial.branch ? { branch: partial.branch } : {}),
    head: partial.head ?? "",
    detached: !!partial.detached,
    bare: !!partial.bare,
    isMain: path.resolve(partial.dir!) === path.resolve(rootPath),
  };
}

async function ensureMemorySymlink(
  rootPath: string,
  worktreeDir: string,
): Promise<void> {
  const srcMemory = path.join(rootPath, ".reflex", "memory");
  // The source dir may not exist yet — symlinking to a missing target
  // is fine; it'll resolve once the user starts writing memory.
  await fs.mkdir(path.dirname(srcMemory), { recursive: true });
  await fs.mkdir(path.join(worktreeDir, ".reflex"), { recursive: true });

  const destMemory = path.join(worktreeDir, ".reflex", "memory");
  // If the worktree branched off a commit that already has its own
  // .reflex/memory dir, replace it with the symlink — memory is global
  // state and should be unified across worktrees.
  try {
    const stat = await fs.lstat(destMemory);
    if (stat.isSymbolicLink()) {
      const cur = await fs.readlink(destMemory);
      if (cur === srcMemory) return; // already correct
    }
    await fs.rm(destMemory, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fs.symlink(srcMemory, destMemory, "dir");
}

async function ensureReflexignoreEntry(rootPath: string): Promise<void> {
  const file = path.join(rootPath, ".reflexignore");
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch {
    /* file missing — we'll create it */
  }
  const lines = current
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.includes(REFLEXIGNORE_ENTRY)) return;
  const next = current
    ? `${current.replace(/\n*$/, "")}\n${REFLEXIGNORE_ENTRY}\n`
    : `${REFLEXIGNORE_ENTRY}\n`;
  await fs.writeFile(file, next, "utf8");
}
