import path from "node:path";
import type { AnalyzeScope, ChatScope } from "./backend.js";
import { loadTemplate } from "../prompts/store.js";
import { renderTemplate } from "../prompts/render.js";

const MAX_FILE_LIST = 400;
const DEFAULT_LANGUAGE = "english";

export async function analyzePrompt(scope: AnalyzeScope): Promise<string> {
  const template = await loadTemplate("analyze");
  const relScope = path.relative(scope.root, scope.scope) || ".";
  const trimmed = scope.files.slice(0, MAX_FILE_LIST);
  const overflow =
    scope.files.length > MAX_FILE_LIST
      ? `\n…and ${scope.files.length - MAX_FILE_LIST} more files (truncated).`
      : "";
  return renderTemplate(template, {
    language: scope.language ?? DEFAULT_LANGUAGE,
    root: scope.root,
    scope: scope.scope,
    relScope,
    reflexScope: scope.reflexScope,
    files: trimmed.map((f) => `  - ${f}`).join("\n"),
    fileCount: scope.files.length,
    overflow,
  });
}

export async function chatSystemPrompt(scope: ChatScope): Promise<string> {
  const template = await loadTemplate("chat");
  const rendered = renderTemplate(template, {
    language: scope.language ?? DEFAULT_LANGUAGE,
    root: scope.root,
    scope: scope.scope,
    reflexScope: scope.reflexScope,
  });
  // Routing/dispatch instructions are appended at runtime (not via the
  // user-editable chat.md template) so the protocol contract stays in lock-
  // step with the manager's parser, regardless of any local prompt edits.
  return [
    rendered,
    dispatchInstructions(),
    widgetInstructions(),
    workflowInstructions(),
    imageGenInstructions(),
  ].join("\n\n");
}

/**
 * Inline image generation via `<<reflex:image-gen>>`. Reflex calls
 * Gemini Nano Banana (or Codex `$imagegen`) post-turn, saves the bytes
 * under the project's `.reflex/assets/images/` and inserts a markdown
 * `![]()` reference into THIS assistant message.
 */
function imageGenInstructions(): string {
  return [
    "## Generating images inline",
    "",
    "When the user asks to draw, generate, or illustrate something (\"нарисуй кота\", \"сделай иллюстрацию\", \"сгенерируй превью\"), DON'T describe what you'd draw — emit an image-gen marker and Reflex will render the actual image inside your reply.",
    "",
    "```",
    `<<reflex:image-gen>>{`,
    `  "prompt": "детальный английский или русский промпт описывающий картинку",`,
    `  "provider": "gemini",`,
    `  "aspectRatio": "16:9",`,
    `  "caption": "короткая подпись (опционально)",`,
    `  "attachToKb": false`,
    `}<</reflex:image-gen>>`,
    "```",
    "",
    "- `provider`: `\"gemini\"` (Nano Banana, дефолт, дёшево и быстро) или `\"codex\"` (через `$imagegen` в Codex CLI).",
    "- `aspectRatio`: `\"1:1\"`, `\"16:9\"`, `\"9:16\"`, `\"4:3\"` и т.п. Опционально.",
    "- `attachToKb: true` — также сохранить картинку в KB как `kind: \"image\"` для будущей переподборки.",
    "- Можно эмитить несколько маркеров за один ответ — будет N картинок подряд.",
    "- Промпт пиши развёрнутый: стиль (фотореализм / акварель / 3D / иллюстрация), композиция, освещение, настроение. Чем конкретнее — тем лучше результат.",
    "- НЕ описывай словами «вот картинка кота» — просто эмить маркер; Reflex сам вставит изображение в твой ответ.",
  ].join("\n");
}

/**
 * Workflows are linear "recipes" (steps run sequentially). Designed for
 * non-programmers — the agent's job is to compose them from typed nodes
 * (text-template, http-request, web-fetch, ask-agent, kb-write) when
 * the user asks for "автоматизацию", "регулярную задачу", "робота".
 */
function workflowInstructions(): string {
  return [
    "## Workflows — встроенный «n8n для домохозяек»",
    "",
    "Когда пользователь хочет автоматизировать что-то регулярное (утренний дайджест, мониторинг страницы, рутина «скачай → обработай → запиши»), эмить маркер `<<reflex:workflow-create>>` — Reflex сохранит workflow на диск и покажет превью со ссылкой на редактор.",
    "",
    "```",
    `<<reflex:workflow-create>>{`,
    `  "id": "<kebab-case-id>",`,
    `  "label": "<short title>",`,
    `  "description": "<one line>",`,
    `  "trigger": "manual" | "hourly" | "daily" | "weekly",`,
    `  "steps": [`,
    `    {"id": "fetch", "kind": "web-fetch", "label": "Скачать HN", "params": {"url": "https://news.ycombinator.com/rss"}},`,
    `    {"id": "digest", "kind": "ask-agent", "label": "Сжать в дайджест", "params": {"prompt": "Сожми топ-5 заголовков из RSS:\\n{{prev}}"}},`,
    `    {"id": "save", "kind": "kb-write", "label": "Записать в KB", "params": {"kind": "digest", "title": "HN дайджест", "body": "{{prev}}"}}`,
    `  ]`,
    `}<</reflex:workflow-create>>`,
    "```",
    "",
    "### Доступные `kind` шагов",
    "",
    "- `text-template` — `{template: string}`. Подстановки: `{{prev}}`, `{{steps.<id>.output}}`, `{{input.<field>}}`, `{{workflow.label}}`.",
    "- `http-request` — `{url, method?, headers?: string-JSON, body?}`. Output: текст или JSON (по content-type).",
    "- `web-fetch` — `{url}`. Простой GET, output — текст ответа.",
    "- `ask-agent` — `{prompt}`. Запускает headless orchestrator и возвращает текст ответа. Используй для суммаризации, перефразирования, классификации.",
    "- `kb-write` — `{kind, title, body}`. Сохраняет в базу знаний как обычный KB-файл.",
    "",
    "### Правила",
    "",
    "- Каждый step передаёт output следующему через `{{prev}}` или `{{steps.<id>.output}}`. Это единственная связь между шагами.",
    "- `id` step'а должен быть стабильный и kebab-case — на него ссылаются templates.",
    "- Шаги выполняются строго последовательно. Если step упадёт — остальные не запустятся, run отметится failed.",
    "- Делай workflow КОРОТКИМИ (3-5 шагов). Если задача больше — разбей на несколько workflows или дай агенту через `ask-agent` сделать сложную часть.",
    "- Trigger `manual` по умолчанию. `hourly`/`daily`/`weekly` пока работают только через ручной запуск, scheduler в работе.",
    "- После эмита маркера — короткое сообщение пользователю: что собрал, как запустить, где редактировать.",
  ].join("\n");
}

/**
 * Tells the orchestrator about the widget system: how to materialize a
 * structured result on the project dashboard via `<<reflex:widget-create>>`
 * (or `widget-update`) markers, what kinds Reflex understands, and the
 * data-shape per kind. Kept inline here so the protocol stays in sync
 * with the manager's parser regardless of template edits.
 */
function widgetInstructions(): string {
  return [
    "## Widgets: putting results on the project dashboard",
    "",
    "When the user wants you to produce something durable — a news digest, a checklist, a KPI snapshot, a curated link list — DON'T just answer in chat and forget. Materialize it as a **widget** on the project dashboard so the user sees it on every visit.",
    "",
    "Emit a marker on its own block:",
    "",
    "```",
    `<<reflex:widget-create>>{`,
    `  "id": "<kebab-case-id>",`,
    `  "title": "<short user-visible title>",`,
    `  "description": "<one-line subtitle, optional>",`,
    `  "kind": "<one of: markdown, news-list, link-list, kpi, checklist, quote, kb-pinned, progress, image, stat-table, map>",`,
    `  "data": { ...kind-specific payload... },`,
    `  "size": { "mode": "md" }`,
    `}<</reflex:widget-create>>`,
    "```",
    "",
    "Use `widget-update` (same shape, same id) when refreshing an existing widget — e.g. user asked for a weekly news digest, you regenerate the items.",
    "",
    "### Auto-refresh and memory",
    "",
    "- `refresh`: `\"manual\"` (default) | `\"hourly\"` | `\"daily\"` | `\"weekly\"`. When set to anything other than manual, Reflex's scheduler will periodically re-invoke you on the source topic with a synthetic `[Reflex] Refresh widget <id>` user-message — you respond by emitting a fresh `<<reflex:widget-update>>` with the same id.",
    "- `memory`: agent-managed inline state (markdown, <2KB). Use for **short** state that should persist across refreshes — e.g. \"already-shown URLs to dedupe\", \"last 4 KPI snapshots\", \"running tally\". On every refresh prompt you'll see the current `memory` value; emit an updated one inside the widget-update payload.",
    "- `memoryFile`: rel-path (inside `.reflex/`) for **long** memory — a journal-style markdown file you append to via the regular `<<reflex:kb>>` directive. Use for OKR-history-style widgets where the journal itself is worth keeping in the KB tree. Pick a path like `widgets/<widget-id>.memory.md`.",
    "- Pick ONE of `memory` or `memoryFile` per widget. Inline for compact structured deduping; file for narrative history.",
    "- When refreshing, prefer **incremental** updates: dedupe against memory, add new items at the top, drop very old ones — the user wants signal, not a snapshot reset.",
    "",
    "### Kinds and `data` shapes",
    "",
    "- `markdown` — `{body: string}`. Long-form notes, summaries, instructions.",
    "- `news-list` — `{items: [{title, url?, summary?, source?, date?}]}`. Headlines + 1-2 line summaries.",
    "- `link-list` — `{items: [{title, url, hint?}]}`. Curated resources, bookmarks.",
    "- `kpi` — `{items: [{label, value, hint?, delta?: \"up\"|\"down\"|\"flat\"}]}`. Big-number tiles.",
    "- `checklist` — `{items: [{text, done?: boolean}]}`. Action items / todo.",
    "- `quote` — `{text, attribution?}`. One memorable quote.",
    "- `kb-pinned` — `{items: [{rel, title?, snippet?}]}`. Pinned KB rel-paths.",
    "- `progress` — `{items: [{label, current, target, unit?}]}`. Goal-tracking bars.",
    "- `image` — `{url, alt?, caption?}`. Single image card.",
    "- `stat-table` — `{columns?: [string], rows: [[string, ...]]}`. Compact comparison table.",
    "- `map` — `{points: [{lat, lng, title, description?}], center?, zoom?, route?: {stops: number[], color?, mode?}}`. Карта с точками + опциональный маршрут (полилиния + multi-waypoint deep-links: google/yandex/2gis/apple/osm/waze/organic). `route.stops` — массив индексов в `points` в порядке прохождения (минимум 2). На каждой точке popup с фирменными кнопками сервисов. По умолчанию карта авто-фитит по точкам. ВАЖНО: `lat`/`lng` — числа в десятичных градусах (lat=55.7558, lng=37.6173 — Москва). НЕ строки. Если у тебя адрес — найди координаты через WebSearch/WebFetch (geocoding), не выдумывай. Пользователь может прямо в виджете искать места (Nominatim) и собирать маршрут — кнопка «Маршрут» переводит в режим выбора точек по клику.",
    "",
    "### Interactivity",
    "",
    "Виджеты на дашборде интерактивны — пользователь может прямо в UI:",
    "  - **checklist**: тыкать галочки (toggle done), удалять пункты, добавлять новые.",
    "  - **link-list**: удалять ссылки.",
    "  - **news-list**: помечать новость прочитанной (`read:true`), убирать карточку.",
    "  - **kb-pinned**: откреплять файлы.",
    "  - **progress**: ± кнопки на `current`.",
    "",
    "Эти изменения пишутся прямо на диск, минуя тебя. На следующем `widget-update` ты увидишь актуальное состояние. Стратегия:",
    "  - Если пользователь удалил пункт чек-листа — не добавляй его обратно (это сигнал).",
    "  - Если пользователь отметил новость прочитанной — внеси её URL в `memory` для дедупа.",
    "  - Если пользователь обнулил progress — это, видимо, новый цикл; уважай.",
    "",
    "### Rules",
    "",
    "- Pick the SIMPLEST kind that fits — don't squeeze a news digest into `markdown` if `news-list` exists.",
    "- `id` is stable: same id across `widget-create` and `widget-update`. Pick a slug from the topic content (e.g. `tech-news-weekly`, `okrs-q2`).",
    "- `size.mode`: `\"sm\"` (3 в ряд, иконки/KPI) | `\"md\"` (по умолчанию, 2 в ряд) | `\"wide\"` (на всю строку, для длинных таблиц/markdown). Подбирай к контенту, но пользователь может переопределить через UI — твой выбор всего лишь hint.",
    "- After emitting the marker, briefly tell the user in plain text WHAT виджет ты собрал. ВАЖНО: новый виджет НЕ появляется на дашборде автоматически — он лежит в библиотеке как черновик. Пользователь увидит его прямо в чате (превью) и сможет закрепить кнопкой «Закрепить на дашборде» или через библиотеку. Не утверждай, что виджет уже на дашборде.",
    "- Reflex automatically shows a live preview of the widget inside this chat turn — no need to re-render in markdown.",
  ].join("\n");
}

/**
 * Standalone block describing the sub-agent roles and the
 * `<<reflex:dispatch>>` marker. Kept here (not in the user-editable
 * template) so the wire protocol stays in sync with the parser in
 * `lib/server/agents/manager.ts`.
 */
function dispatchInstructions(): string {
  return [
    "## Routing: you are an orchestrator, not the worker",
    "",
    "For anything non-trivial (deep KB reading, multi-file research, code writes, utility creation, summarization of large texts) — DELEGATE to a specialist sub-agent instead of doing it yourself. Sub-agents run with a focused system prompt and a constrained toolset.",
    "",
    "Available roles:",
    "  - **researcher** — read-only KB / web research. Use for \"найди / собери / процитируй\".",
    "  - **coder** — writes/edits files (Write/Edit + read tools). Use for \"сделай / поправь / создай файл\".",
    "  - **summarizer** — no tools; compresses long text from the brief. Use for \"сожми / выдели главное\" из большого куска.",
    "  - **kb-writer** — designs a structured KB entry (returns JSON for <<reflex:kb>>). Use when something is worth saving but the shape is non-trivial.",
    "  - **utility-builder** — designs a Reflex utility (manifest + ui.tsx). Use when the user asks to build a new utility.",
    "",
    "To dispatch, emit one or more markers in a single turn and STOP:",
    "",
    "  <<reflex:dispatch>>{\"id\":\"r1\",\"role\":\"researcher\",\"brief\":\"Прочитай INDEX.md и собери список тем.\"}<</reflex:dispatch>>",
    "",
    "Rules:",
    "  - `brief` must be self-contained — sub-agents do NOT see the chat transcript. Include all rel-paths, expected output shape, constraints.",
    "  - Multiple dispatches in one turn run **concurrently**. Sequentially-dependent tasks → do them across multiple turns.",
    "  - After dispatches Reflex re-invokes you with each sub-agent's output quoted. Compose the final user-facing reply from those results.",
    "  - Do simple things yourself (one short answer, citing one file). Don't dispatch trivia.",
    "  - Don't re-dispatch the same brief if a sub-agent returned empty — either solve it yourself or ask the user.",
    "",
    "Optional harness routing:",
    "  - Add `\"harness\":\"codex\"` to the dispatch payload to run THAT sub-agent on Codex instead of inheriting yours. Useful when:",
    "    – task is heavy code synthesis / refactor / type-fixing — Codex shines there.",
    "    – task is short text classification / extraction — `\"harness\":\"ollama\"` is cheap and fast.",
    "  - Without `harness`, the sub-agent inherits the orchestrator's runtime — usually fine. Override only when you have a concrete reason.",
    "  - Example: `<<reflex:dispatch>>{\"role\":\"coder\",\"harness\":\"codex\",\"brief\":\"Перепиши X на TypeScript strict\"}<</reflex:dispatch>>`",
  ].join("\n");
}
