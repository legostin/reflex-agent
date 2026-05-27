/**
 * Agent backend abstraction.
 *
 * Keep this interface free of Codex- or Claude-specific types so backends stay
 * swappable. Reflex calls `analyzeScope` to (re)build KB MDs for a subtree, and
 * `chat` to open an interactive chat scoped to a folder's KB.
 */

export interface AnalyzeScope {
  /** Absolute path of the root the user pointed Reflex at. */
  root: string;
  /** Absolute path of the subtree to (re)analyze. May equal `root`. */
  scope: string;
  /** Absolute path of the .reflex/ tree mirroring this scope. */
  reflexScope: string;
  /** Files under scope that are visible after ignore filtering, relative to scope. */
  files: ReadonlyArray<string>;
  /** Optional model id to pass to the underlying CLI (e.g. `claude-opus-4-7`). */
  model?: string;
  /** Natural language artifacts should be written in (used by the analyze template). */
  language?: string;
}

export interface ChatScope {
  root: string;
  /** The folder the user is chatting "inside". May equal root. */
  scope: string;
  /** The .reflex/ folder mirroring `scope` (where INDEX.md + topic MDs live). */
  reflexScope: string;
  /** Natural language replies should be written in. */
  language?: string;
}

export interface AgentBackend {
  readonly id: string;
  /** Build or refresh the KB MDs for the given scope. */
  analyzeScope(scope: AnalyzeScope): Promise<void>;
  /** Start an interactive chat scoped to a folder's KB. Resolves when chat exits. */
  chat(scope: ChatScope): Promise<void>;
}

export class AgentUnavailableError extends Error {
  constructor(backendId: string, cause: unknown) {
    super(
      `Agent backend "${backendId}" is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "AgentUnavailableError";
  }
}
