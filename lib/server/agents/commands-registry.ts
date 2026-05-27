/**
 * Single source of truth for chat slash-commands. Every command shows up
 * in the `/` palette autocomplete (UI reads this list via a server action)
 * and routes through one of two execution paths:
 *
 *   - "direct"      — handled by a client-side / server-action pair,
 *                     never starts an agent turn (`/remember`, `/delete-topic`,
 *                     `/clear-project`, `/help`).
 *
 *   - "agent-mode"  — message goes to the orchestrator as usual; the
 *                     command word is stripped and `commandId` is passed
 *                     into start-turn so the system prompt gets a
 *                     command-specific addendum (`/plan`, `/goal`,
 *                     `/research`, `/widget`, `/mcp`, `/skill`).
 *
 * Adding a new command:
 *   1. add an entry below with metadata
 *   2. if "direct": add the server action + wire the client handler
 *   3. if "agent-mode": add the instructions helper in slash-commands.ts
 *      and a case in start-turn.ts (or skill loader for /skill)
 */

export type CommandKind = "direct" | "agent-mode";

export interface CommandDef {
  id: string;
  /** What the user types — exact match after the leading `/`. */
  trigger: string;
  /** Short human-readable label for the palette. */
  label: string;
  /** One-line description, shown in palette and /help. */
  description: string;
  kind: CommandKind;
  /** Free-form usage hint (`/cmd <text>` style). */
  usage: string;
  /** Whether the command needs explicit confirm before firing (UI uses confirm()). */
  requiresConfirm?: boolean;
  /** When true, the command works without any text payload. */
  allowEmpty?: boolean;
  /** Icon name from lucide-react — UI maps string → component. */
  icon: string;
}

export const COMMANDS: CommandDef[] = [
  {
    id: "plan",
    trigger: "plan",
    label: "/plan",
    description:
      "Сначала покажи план — Reflex распишет шаги и подождёт одобрения.",
    kind: "agent-mode",
    usage: "/plan <задача>",
    icon: "ListChecks",
  },
  {
    id: "goal",
    trigger: "goal",
    label: "/goal",
    description:
      "Поставь цель — Reflex будет двигаться к ней сам, без напоминаний.",
    kind: "agent-mode",
    usage: "/goal <чего достичь>",
    icon: "Target",
  },
  {
    id: "research",
    trigger: "research",
    label: "/research",
    description:
      "Глубокое исследование темы — поиск в интернете + сводка с источниками.",
    kind: "agent-mode",
    usage: "/research <тема>",
    icon: "Telescope",
  },
  {
    id: "widget",
    trigger: "widget",
    label: "/widget",
    description: "Создать карточку на дашборде пространства.",
    kind: "agent-mode",
    usage: "/widget <что показать>",
    icon: "LayoutGrid",
  },
  {
    id: "workflow",
    trigger: "workflow",
    label: "/workflow",
    description:
      "Собрать рецепт — линейная автоматизация из шагов под задачу.",
    kind: "agent-mode",
    usage: "/workflow <что автоматизировать>",
    icon: "Workflow",
  },
  {
    id: "remember",
    trigger: "remember",
    label: "/remember",
    description: "Запомнить заметку — сразу в память, без обращения к AI.",
    kind: "direct",
    usage: "/remember <что запомнить>",
    icon: "BookmarkPlus",
  },
  {
    id: "mcp",
    trigger: "mcp",
    label: "/mcp",
    description: "Подключить внешний сервис (мастер настройки откроется в чате).",
    kind: "agent-mode",
    usage: "/mcp <что нужно>",
    icon: "PackagePlus",
  },
  {
    id: "skill",
    trigger: "skill",
    label: "/skill",
    description: "Подключить роль — готовый набор инструкций на этот разговор.",
    kind: "agent-mode",
    usage: "/skill <id-роли> [запрос]",
    icon: "Sparkles",
  },
  {
    id: "delete-topic",
    trigger: "delete-topic",
    label: "/delete-topic",
    description: "Удалить этот разговор (с подтверждением).",
    kind: "direct",
    usage: "/delete-topic",
    requiresConfirm: true,
    allowEmpty: true,
    icon: "Trash2",
  },
  {
    id: "clear-project",
    trigger: "clear-project",
    label: "/clear-project",
    description:
      "ОПАСНО: очистить пространство — все разговоры, карточки, память. Двойное подтверждение.",
    kind: "direct",
    usage: "/clear-project",
    requiresConfirm: true,
    allowEmpty: true,
    icon: "AlertOctagon",
  },
  {
    id: "util",
    trigger: "util",
    label: "/util",
    description: "Открыть мини-приложение (по части названия или из списка).",
    kind: "direct",
    usage: "/util <часть названия или id>",
    allowEmpty: true,
    icon: "Boxes",
  },
  {
    id: "help",
    trigger: "help",
    label: "/help",
    description: "Список доступных команд.",
    kind: "direct",
    usage: "/help",
    allowEmpty: true,
    icon: "HelpCircle",
  },
];

export function findCommand(trigger: string): CommandDef | null {
  return COMMANDS.find((c) => c.trigger === trigger) ?? null;
}

/**
 * Parse a chat message looking for a leading `/cmd <payload>`. Returns the
 * matching CommandDef plus the trimmed payload. `null` means "just a
 * regular message — no command here".
 */
export function detectCommand(
  message: string,
): { def: CommandDef; payload: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;
  // Use a tight regex so legit messages that contain slashes mid-text don't
  // get misinterpreted.
  const m = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!m) return null;
  const def = findCommand(m[1]!);
  if (!def) return null;
  return { def, payload: (m[2] ?? "").trim() };
}
