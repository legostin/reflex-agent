import "server-only";
import { detectCommand } from "./commands-registry";

/**
 * Slash commands that turn into agent-mode turns. Direct-action commands
 * (`/remember`, `/delete-topic`, `/clear-project`, `/help`) never reach
 * here — they're intercepted client-side.
 *
 * The legacy `/plan` and `/goal` callers expect a small narrow shape; the
 * new commands (`/research`, `/widget`, `/mcp`, `/skill`) plug in via
 * `agentModeInstructions(id, payload, language)`.
 */

export type SlashCommandKind = "plan" | "goal";

export interface SlashCommand {
  /** Recognised legacy kind for plan/goal handling in start-turn. */
  kind: SlashCommandKind;
  /** The user's payload after the command word. */
  text: string;
}

export function detectSlashCommand(message: string): SlashCommand | null {
  const c = detectCommand(message);
  if (!c) return null;
  if (c.def.id === "plan" || c.def.id === "goal") {
    return { kind: c.def.id, text: c.payload };
  }
  return null;
}

export function planInstructions(language: string): string {
  return [
    "## /plan — Plan-first mode",
    "",
    `Reply in ${language}. **Before doing anything**, lay out a clear, numbered step-by-step plan. Each step should be concrete and verifiable.`,
    "",
    "Once the plan is ready, emit a question marker requesting approval:",
    "",
    `  <<reflex:question>>{"prompt":"Approve this plan?","choices":["approve","revise"]}<</reflex:question>>`,
    "",
    "Then STOP and wait for the user's reply.",
    "",
    "On the next turn:",
    "  - If the user approved → execute the plan, narrating progress and tools used.",
    "  - If the user asked to revise/change → update the plan and emit another approval question.",
    "Iterate until the user explicitly approves. Do not begin execution until then.",
  ].join("\n");
}

export function goalInstructions(goal: string, language: string): string {
  return [
    "## /goal — Persistent goal mode (do not stop until validated)",
    "",
    `Active goal: ${goal}`,
    "",
    `Reply in ${language}. Reflex will keep re-invoking you turn after turn until the goal is achieved AND validated. Don't write filler — every turn must move the task forward.`,
    "",
    "Workflow each turn:",
    "  1. Take the next concrete action toward the goal (use tools when needed: Read, Glob, Grep, WebSearch, WebFetch, etc.).",
    "  2. Show your work briefly so the user can audit progress.",
    "  3. When you believe the goal is complete, **validate it** (verify with a tool: read the file, fetch the URL, run a search). Don't claim completion without evidence.",
    "  4. After successful validation, emit a KB record:",
    "",
    `     <<reflex:kb>>{"kind":"goal-completion","title":"<short>","body":"<what was done + validation evidence>","meta":{"goal":${JSON.stringify(goal)}}}<</reflex:kb>>`,
    "",
    "     And END your message with the literal phrase on its own line:",
    "",
    "     GOAL ACHIEVED",
    "",
    "If you genuinely need user input mid-flight (clarification, permission for a risky action, missing data), pause via <<reflex:question>> or <<reflex:permission>>. Those markers stop auto-continuation; everything else keeps the loop going.",
  ].join("\n");
}

/**
 * "/research" — deep-research mode for a single turn. The orchestrator
 * is encouraged to dispatch a researcher sub-agent and iterate widely
 * across web + KB before synthesizing.
 */
export function researchInstructions(payload: string, language: string): string {
  return [
    "## /research — Deep research mode (this turn)",
    "",
    `Reply in ${language}.`,
    payload ? `Topic: ${payload}` : "",
    "",
    "Approach:",
    "  1. Delegate the main search to a sub-agent with role `researcher` via `<<reflex:dispatch>>` (one marker — it will sweep web + KB on its own).",
    "  2. If possible — multiple researchers in parallel with different angles (e.g. \"history\", \"current state\", \"criticism\").",
    "  3. Wait for results, **compose a synthesis**: similarities, disagreements, blind spots. Cite sources with links.",
    "  4. At the end, propose saving key facts to the KB via the `<<reflex:kb>>` marker (kind=\"research-note\") — but wait for confirmation.",
    "  5. If the topic is deep — propose a `news-list` or `link-list` widget via `<<reflex:widget-create>>`.",
    "",
    "Don't answer from model memory — drive everything through WebSearch/WebFetch.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * "/widget" — focus the agent on creating or refreshing a dashboard widget.
 */
export function widgetInstructionsForCommand(
  payload: string,
  language: string,
): string {
  return [
    "## /widget — Create a dashboard widget",
    "",
    `Reply in ${language}.`,
    payload ? `User request: ${payload}` : "",
    "",
    "Rules:",
    "  1. Pick the appropriate `kind` (see the widgets block in the system prompt). If the request is ambiguous — ask via `<<reflex:question>>`.",
    "  2. Pick a stable kebab-case `id` that can later be reused for widget-update.",
    "  3. If you need fresh data (news, prices, statuses) — gather it via WebSearch/WebFetch before emitting.",
    "  4. Emit **one** `<<reflex:widget-create>>` marker in this turn, then briefly tell the user what appeared on the dashboard.",
    "  5. If the widget makes sense to auto-refresh — set `refresh: \"hourly\"|\"daily\"|\"weekly\"` and describe `memory` for dedup/history.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * "/workflow" — focus the turn on building a workflow (linear recipe of
 * steps) via the `<<reflex:workflow-create>>` directive. The base chat
 * prompt already includes the protocol shape; this addendum nudges the
 * agent to actually use it and constrains style.
 */
export function workflowInstructionsForCommand(
  payload: string,
  language: string,
): string {
  return [
    "## /workflow — Build a workflow (n8n-style linear recipe)",
    "",
    `Reply in ${language}.`,
    payload ? `User request: ${payload}` : "",
    "",
    "Rules:",
    "  1. If the task is ambiguous (what's included, where to write, how often) — ask 1-3 clarifying questions via `<<reflex:question>>` in a SINGLE block. Don't guess.",
    "  2. Steps are SHORT (3-5). Supported kinds: `text-template`, `http-request`, `web-fetch`, `ask-agent`, `kb-write`. If the task is broader — split it into multiple workflows.",
    "  3. Each step's `id` is stable kebab-case (templates use it: `{{steps.<id>.output}}`).",
    "  4. Trigger defaults to `manual`. Set `hourly/daily/weekly` only if the user explicitly asked for a schedule.",
    "  5. Emit **one** `<<reflex:workflow-create>>` marker in this turn. Don't duplicate the JSON in text — the preview card renders in chat automatically.",
    "  6. After the marker — a short plan in words: what the workflow does step by step, how to run it, what appears as the result.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * "/mcp" — short-circuit to the MCP setup wizard flow. The agent already
 * has detailed mcp-add instructions in the base chat prompt; this command
 * just nudges it to start the conversation in that direction.
 */
export function mcpInstructionsForCommand(
  payload: string,
  language: string,
): string {
  return [
    "## /mcp — Connect an MCP server",
    "",
    `Reply in ${language}.`,
    payload ? `Request: ${payload}` : "The user wants to connect an MCP server but didn't specify which one.",
    "",
    "Act as an MCP wizard:",
    "  1. If the request is concrete (e.g. \"github mcp\", \"notion\") — pick a config right away and propose it via `<<reflex:mcp-add>>`. Don't forget secrets slots with a description of where to get the token.",
    "  2. If the request is abstract — ask via `<<reflex:question>>` what to connect (Notion / Slack / GitHub / Linear / other).",
    "  3. If it's about an existing server — ask the user to use its tools; don't propose the add card again.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const MAX_GOAL_ITERATIONS = 15;
