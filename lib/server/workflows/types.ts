/**
 * Workflows = linear "recipes" the user composes from a handful of typed
 * nodes (ask-agent, http-request, kb-write, text-template, web-fetch).
 * Designed for non-programmers — no DAGs, no branching syntax, no code
 * mode. The agent can compose them via `<<reflex:workflow-create>>`, the
 * UI lets the user tweak steps after creation.
 *
 * State flow: each step produces a JSON `output`. Subsequent steps see
 * all prior outputs via the `{{steps.<id>.output}}` mustache-like syntax
 * (or `{{prev}}` for the immediately preceding step's output). The
 * runner renders params before invoking the node handler.
 */

export type WorkflowTrigger = "manual" | "hourly" | "daily" | "weekly";

export type WorkflowStepKind =
  | "text-template"
  | "http-request"
  | "web-fetch"
  | "ask-agent"
  | "kb-write"
  | "utility-call"
  | "image-generate"
  | "image-search";

export interface WorkflowStep {
  /** Stable id within the workflow — referenced by templates and run logs. */
  id: string;
  kind: WorkflowStepKind;
  /** User-visible label, shown on the step card. */
  label: string;
  /** Kind-specific JSON params. Strings inside are template-rendered. */
  params: Record<string, unknown>;
}

export interface WorkflowDef {
  id: string;
  label: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  /** Topic that authored or last edited this workflow (pencil → chat). */
  sourceTopicId?: string;
}

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StepRunResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Resolved params (after template rendering) — useful for debugging. */
  renderedParams?: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowLabel: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  steps: StepRunResult[];
  /** Optional initial payload from the trigger source. */
  initialInput?: unknown;
}

export interface WorkflowKindMeta {
  kind: WorkflowStepKind;
  label: string;
  description: string;
  /** Sample params used when adding the step via "+" picker. */
  defaultParams: Record<string, unknown>;
  /** Field hints for the params editor (kind → input type). */
  fields: Array<{
    key: string;
    label: string;
    type: "string" | "text" | "url" | "json" | "select";
    hint?: string;
    options?: string[];
    placeholder?: string;
  }>;
}

export const WORKFLOW_KINDS: WorkflowKindMeta[] = [
  {
    kind: "text-template",
    label: "Шаблон текста",
    description:
      "Собирает текст из шаблона с подстановками из предыдущих шагов. Используй как «склейку» данных перед следующим шагом.",
    defaultParams: { template: "Hello {{prev}}" },
    fields: [
      {
        key: "template",
        label: "Шаблон",
        type: "text",
        hint: "Подстановки: {{prev}}, {{steps.<id>.output}}, {{input.<field>}}",
        placeholder: "Сводка: {{prev}}",
      },
    ],
  },
  {
    kind: "http-request",
    label: "HTTP-запрос",
    description:
      "Делает HTTP-запрос (GET по умолчанию). Тело ответа кладёт в output как строку или JSON, если application/json.",
    defaultParams: { url: "https://api.example.com/", method: "GET" },
    fields: [
      { key: "url", label: "URL", type: "url", placeholder: "https://…" },
      {
        key: "method",
        label: "Метод",
        type: "select",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      },
      {
        key: "headers",
        label: "Headers (JSON)",
        type: "json",
        hint: "Например: {\"Authorization\":\"Bearer …\"}",
      },
      { key: "body", label: "Body", type: "text", hint: "Пусто для GET" },
    ],
  },
  {
    kind: "web-fetch",
    label: "Скачать страницу",
    description:
      "Запрашивает URL и возвращает текстовое содержимое. Удобно для парсинга страниц без боли HTTP-настроек.",
    defaultParams: { url: "https://example.com" },
    fields: [
      { key: "url", label: "URL", type: "url", placeholder: "https://…" },
    ],
  },
  {
    kind: "ask-agent",
    label: "Спросить агента",
    description:
      "Запустить headless orchestrator-агента с указанным вопросом. Output — ответ агента (полный текст ассистента).",
    defaultParams: { prompt: "Кратко суммаризируй: {{prev}}" },
    fields: [
      {
        key: "prompt",
        label: "Вопрос агенту",
        type: "text",
        placeholder: "Используй {{prev}} чтобы передать вход",
      },
    ],
  },
  {
    kind: "kb-write",
    label: "Записать в KB",
    description:
      "Сохраняет в базу знаний как Markdown-файл с frontmatter (kind, title, body). Используй output предыдущего шага как `body`.",
    defaultParams: {
      kind: "note",
      title: "Из workflow {{workflow.label}}",
      body: "{{prev}}",
    },
    fields: [
      { key: "kind", label: "Kind", type: "string", placeholder: "note" },
      {
        key: "title",
        label: "Title",
        type: "string",
        placeholder: "{{workflow.label}}",
      },
      {
        key: "body",
        label: "Body (Markdown)",
        type: "text",
        placeholder: "{{prev}}",
      },
    ],
  },
  {
    kind: "utility-call",
    label: "Вызвать мини-приложение",
    description:
      "Запускает named server-action установленной утилиты с переданными args. Output = результат action. utility-call позволяет workflow'у пользоваться функциями мини-приложений как библиотекой.",
    defaultParams: {
      utilityId: "",
      utilityScope: "global",
      actionName: "",
      args: "{}",
    },
    fields: [
      {
        key: "utilityId",
        label: "Утилита (id)",
        type: "string",
        placeholder: "my-utility",
      },
      {
        key: "utilityScope",
        label: "Scope",
        type: "select",
        options: ["global", "project"],
      },
      {
        key: "actionName",
        label: "Действие",
        type: "string",
        placeholder: "имя из manifest.serverActions",
      },
      {
        key: "args",
        label: "Аргументы (JSON)",
        type: "json",
        hint: "Передаются как первый аргумент action. Подстановки {{prev}} работают внутри строк JSON.",
      },
    ],
  },
  {
    kind: "image-generate",
    label: "Сгенерировать картинку",
    description:
      "Генерирует картинку через Gemini Nano Banana или Codex `$imagegen`. Output: {url, sha, mime, provider} — `url` можно вставить в kb-write body как `![]({{steps.<id>.output.url}})`.",
    defaultParams: {
      prompt: "симпатичный енот в скафандре, акварель",
      provider: "gemini",
      aspectRatio: "1:1",
    },
    fields: [
      {
        key: "prompt",
        label: "Промпт",
        type: "text",
        placeholder: "Описание картинки",
      },
      {
        key: "provider",
        label: "Провайдер",
        type: "select",
        options: ["gemini", "codex"],
      },
      {
        key: "aspectRatio",
        label: "Соотношение",
        type: "select",
        options: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
      },
      {
        key: "size",
        label: "Размер (опц.)",
        type: "string",
        placeholder: "1024x1024",
      },
    ],
  },
  {
    kind: "image-search",
    label: "Найти картинки в сети",
    description:
      "Ищет готовые изображения по запросу (Unsplash по умолчанию, Pexels как fallback). Output: {results: [{url, thumb, attribution}…]}.",
    defaultParams: {
      query: "mountains sunrise",
      provider: "unsplash",
      count: 6,
    },
    fields: [
      {
        key: "query",
        label: "Запрос",
        type: "string",
        placeholder: "mountains sunrise",
      },
      {
        key: "provider",
        label: "Провайдер",
        type: "select",
        options: ["unsplash", "pexels", "brave"],
      },
      {
        key: "count",
        label: "Сколько результатов",
        type: "string",
        placeholder: "6",
      },
    ],
  },
];

export function getKindMeta(kind: WorkflowStepKind): WorkflowKindMeta | null {
  return WORKFLOW_KINDS.find((k) => k.kind === kind) ?? null;
}
