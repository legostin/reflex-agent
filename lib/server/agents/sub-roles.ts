import "server-only";

/**
 * Catalog of specialist sub-agent roles the orchestrator can dispatch.
 *
 * Each role has a tight system prompt and an `allowedTools` allowlist so the
 * specialist can't drift outside its lane (e.g. the `researcher` is read-only
 * and can't Write/Edit). When the orchestrator emits
 *   <<reflex:dispatch>>{"role":"researcher","brief":"…"}<</reflex:dispatch>>
 * the manager spawns a fresh agent with this role's prompt, runs **one turn**
 * with `brief` as the user message, captures the assistant text, then feeds
 * all sub-agent results back into the orchestrator as a synthesized user
 * message so it can compose the user-facing answer.
 *
 * Adding a new role here is the only place that needs to change for new
 * specialists — everything else (dispatch parser, spawn flow, UI badge) is
 * data-driven.
 */

export type SubAgentRoleId =
  | "researcher"
  | "coder"
  | "summarizer"
  | "kb-writer"
  | "utility-builder";

export interface SubAgentRoleDef {
  id: SubAgentRoleId;
  /** Short label shown as a badge in the UI. */
  label: string;
  /** One-line description shown to the orchestrator when it's choosing. */
  description: string;
  /** Tools this role may use. Subset of the orchestrator's full toolset. */
  allowedTools: string[];
  /** Build the system prompt given runtime context. */
  systemPrompt(args: {
    language: string;
    root: string;
    reflexScope: string;
    brief: string;
  }): string;
}

const READ_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"];
const WRITE_TOOLS = [...READ_TOOLS, "Write", "Edit", "MultiEdit"];

function header(role: string, language: string, brief: string): string {
  return [
    `## Specialist role: ${role}`,
    "",
    `Reply in ${language}. You are a focused specialist, not a general assistant. Do exactly the task in the brief — no more.`,
    "",
    "## Brief from the orchestrator",
    brief.trim(),
    "",
  ].join("\n");
}

function footer(roleNotes: string): string {
  return [
    "",
    "## Rules",
    roleNotes,
    "",
    "- Don't ask clarifying questions to the user — you don't have a chat surface. If the brief is ambiguous, do your best with stated assumptions and note them in your output.",
    "- Don't emit `<<reflex:kb>>`, `<<reflex:utility>>`, `<<reflex:permission>>`, `<<reflex:question>>`, `<<reflex:dispatch>>` markers — those are for the orchestrator only. Just write your answer as plain text/markdown.",
    "- End with a tight summary the orchestrator can quote verbatim if the user asks for the result.",
  ].join("\n");
}

export const SUB_AGENT_ROLES: Record<SubAgentRoleId, SubAgentRoleDef> = {
  researcher: {
    id: "researcher",
    label: "Researcher",
    description:
      "Deep KB reading / project search / web research. Read-only — never writes files. Use when you need to find or gather facts.",
    allowedTools: READ_TOOLS,
    systemPrompt: ({ language, root, reflexScope, brief }) =>
      [
        header("researcher", language, brief),
        `Project root: \`${root}\``,
        `Knowledge base scope: \`${reflexScope}\``,
        footer(
          [
            "- You are READ-ONLY: never Write/Edit/MultiEdit. Use Read/Glob/Grep to scan the KB and WebFetch/WebSearch for external lookups.",
            "- Cite sources by rel-path inside the KB (or URL for web).",
            "- If the brief asks for something that requires a write, explicitly say `cannot complete — write required` instead of doing it.",
          ].join("\n"),
        ),
      ].join("\n"),
  },
  coder: {
    id: "coder",
    label: "Coder",
    description:
      "Writes/edits source code, configs, schemas. Can create a utility. Use when file changes are required.",
    allowedTools: WRITE_TOOLS,
    systemPrompt: ({ language, root, reflexScope, brief }) =>
      [
        header("coder", language, brief),
        `Project root: \`${root}\``,
        `Reflex scope (write here for KB files): \`${reflexScope}\``,
        footer(
          [
            "- You may Write/Edit/MultiEdit files. Stay inside the project root.",
            "- Don't run shell or invoke other agents. If the brief implies installing a utility, write the utility files but do NOT emit `<<reflex:utility>>` — that's the orchestrator's job.",
            "- Report what you changed: list each touched file with a one-line summary.",
          ].join("\n"),
        ),
      ].join("\n"),
  },
  summarizer: {
    id: "summarizer",
    label: "Summarizer",
    description:
      "Compresses a large text / long transcript / file list into a short summary. No tools — only the text in the brief.",
    allowedTools: [],
    systemPrompt: ({ language, brief }) =>
      [
        header("summarizer", language, brief),
        footer(
          [
            "- You have NO tools — work only from the text in the brief.",
            "- Compress aggressively: bullet points, ~10x reduction is the target unless the brief says otherwise.",
            "- Preserve names, numbers, dates, file paths verbatim. Drop filler.",
          ].join("\n"),
        ),
      ].join("\n"),
  },
  "kb-writer": {
    id: "kb-writer",
    label: "KB Writer",
    description:
      "Structured knowledge-base entry (kind/title/body/frontmatter). Use when the orchestrator decides to save something.",
    allowedTools: READ_TOOLS,
    systemPrompt: ({ language, root, reflexScope, brief }) =>
      [
        header("kb-writer", language, brief),
        `KB root: \`${reflexScope}\``,
        `Project: \`${root}\``,
        footer(
          [
            "- You DO NOT write the file yourself. Output a JSON object the orchestrator will pass to <<reflex:kb>>:",
            "    ```json",
            '    {"kind":"<entity-type>","title":"…","body":"…markdown…","meta":{…optional frontmatter fields…}}',
            "    ```",
            "- Pick a sensible `kind` (fact / task / meeting / product / decision / source / …).",
            "- `body` is full markdown. Frontmatter `meta` should hold structured fields the user might filter/group on.",
          ].join("\n"),
        ),
      ].join("\n"),
  },
  "utility-builder": {
    id: "utility-builder",
    label: "Utility Builder",
    description:
      "Design a utility: manifest + ui.tsx + (optional) server actions. Use when the user explicitly asks to create a utility.",
    allowedTools: READ_TOOLS,
    systemPrompt: ({ language, root, brief }) =>
      [
        header("utility-builder", language, brief),
        `Project: \`${root}\``,
        footer(
          [
            "- Output the utility files inline in markdown code fences with file paths as headers:",
            "    ### manifest.json",
            "    ```json",
            "    { … }",
            "    ```",
            "    ### ui.tsx",
            "    ```tsx",
            "    … React functional component, default-export …",
            "    ```",
            "- Follow Reflex utility contract: imports only from `react`, `react-dom/client`, `react/jsx-runtime`, `@host/api`, `@host/ui`. Declare needed permissions and secrets in manifest.",
            "- Don't emit `<<reflex:utility>>` yourself — the orchestrator wraps your output and emits the marker.",
          ].join("\n"),
        ),
      ].join("\n"),
  },
};

export function listRolesForPrompt(): string {
  return Object.values(SUB_AGENT_ROLES)
    .map((r) => `- **${r.id}** (${r.label}) — ${r.description}`)
    .join("\n");
}

export function isSubAgentRole(id: string): id is SubAgentRoleId {
  return id in SUB_AGENT_ROLES;
}
