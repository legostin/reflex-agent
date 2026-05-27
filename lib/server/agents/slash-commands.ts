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
    payload ? `Тема: ${payload}` : "",
    "",
    "Подход:",
    "  1. Делегируй основной поиск sub-агенту с ролью `researcher` через `<<reflex:dispatch>>` (одним маркером — он сам пройдётся по web + KB).",
    "  2. Если возможно — несколько researcher'ов параллельно с разными углами (например: «история», «текущее состояние», «критика»).",
    "  3. Дождись результатов, **компонуй синтез**: сходства, разногласия, белые пятна. Цитируй источники со ссылками.",
    "  4. В конце предложи сохранить ключевые факты в KB маркером `<<reflex:kb>>` (kind=\"research-note\") — но дождись подтверждения.",
    "  5. Если тема глубокая — предложи виджет `news-list` или `link-list` через `<<reflex:widget-create>>`.",
    "",
    "Не отвечай из памяти модели — гони через WebSearch/WebFetch.",
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
    "## /widget — Создание виджета на дашборде",
    "",
    `Reply in ${language}.`,
    payload ? `Запрос пользователя: ${payload}` : "",
    "",
    "Правила:",
    "  1. Выбери подходящий `kind` (см. блок про widgets в системном промпте). Если запрос неоднозначный — спроси через `<<reflex:question>>`.",
    "  2. Подбери стабильный kebab-case `id`, который потом можно будет переиспользовать для widget-update.",
    "  3. Если нужны актуальные данные (новости, цены, статусы) — собери через WebSearch/WebFetch перед эмитом.",
    "  4. Эмить **один** `<<reflex:widget-create>>` маркер в этом ходе, потом коротко расскажи пользователю что появилось на дашборде.",
    "  5. Если виджет имеет смысл авто-обновлять — поставь `refresh: \"hourly\"|\"daily\"|\"weekly\"` и опиши `memory` для дедупа/истории.",
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
    "## /workflow — Сборка workflow (n8n-style линейный рецепт)",
    "",
    `Reply in ${language}.`,
    payload ? `Запрос пользователя: ${payload}` : "",
    "",
    "Правила:",
    "  1. Если задача неоднозначная (что входит, куда писать, как часто) — задай 1-3 уточняющих вопроса через `<<reflex:question>>` ОДНИМ блоком. Не угадывай.",
    "  2. Шаги КОРОТКИЕ (3-5). Поддерживаемые типы: `text-template`, `http-request`, `web-fetch`, `ask-agent`, `kb-write`. Если задача шире — разбей на несколько workflows.",
    "  3. `id` каждого шага — стабильный kebab-case (его используют шаблоны: `{{steps.<id>.output}}`).",
    "  4. Trigger по умолчанию `manual`. `hourly/daily/weekly` ставь, только если пользователь явно попросил периодичность.",
    "  5. Эмить **один** `<<reflex:workflow-create>>` маркер в этом ходе. Не дублируй JSON в текст — карточка превью отрендерится в чате автоматически.",
    "  6. После маркера — короткий план словами: что workflow делает по шагам, как запустить, что появится в результате.",
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
    "## /mcp — Подключение MCP-сервера",
    "",
    `Reply in ${language}.`,
    payload ? `Запрос: ${payload}` : "Пользователь хочет подключить MCP-сервер, но не уточнил какой.",
    "",
    "Действуй как MCP-визард:",
    "  1. Если запрос конкретный (например «github mcp», «notion») — сразу подбери конфиг и предложи через `<<reflex:mcp-add>>`. Не забудь про secrets-слоты с описанием где взять токен.",
    "  2. Если запрос абстрактный — спроси через `<<reflex:question>>` что нужно подключить (Notion / Slack / GitHub / Linear / другое).",
    "  3. Если речь о существующем сервере — попроси использовать его инструменты, не предлагай add-карточку повторно.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const MAX_GOAL_ITERATIONS = 15;
