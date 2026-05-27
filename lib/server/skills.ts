import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { reflexHome } from "@/lib/reflex/home";

/**
 * "Skills" = reusable instruction packs the user (or agent) can apply to
 * a turn via `/skill <id>`. Each skill is a markdown file with YAML
 * frontmatter:
 *
 *   ---
 *   id: deep-research
 *   title: "Deep research"
 *   description: "Web + KB research with citations"
 *   author: builtin
 *   ---
 *   ## Instructions
 *   ...the agent reads this verbatim...
 *
 * Lookup order (first hit wins):
 *   1. `~/.reflex/skills/<id>.md`         (user-installed, persisted across projects)
 *   2. built-in skills bundled below
 *
 * Future: per-root skills, MCP-bound skills, skills with permission scopes.
 * For v1 the contract is intentionally tiny: it's just an instructions
 * blob the system prompt gets for that one turn.
 */

export interface SkillMeta {
  id: string;
  title: string;
  description: string;
  /** "builtin" for in-process skills, "user" for filesystem-installed. */
  author: "builtin" | "user";
}

export interface Skill extends SkillMeta {
  instructions: string;
}

const USER_DIR = path.join(reflexHome(), "skills");

const BUILTIN: Skill[] = [
  {
    id: "deep-research",
    title: "Deep research",
    description:
      "Глубокий ресёрч с цитированием — web + KB, синтез через researcher sub-agents.",
    author: "builtin",
    instructions: [
      "## Skill: deep-research",
      "",
      "Веди исследование как профессиональный аналитик:",
      "  1. Сначала составь короткий план поиска: 3-5 ключевых вопросов вокруг темы.",
      "  2. Для каждого ключевого вопроса диспатчни researcher sub-агента с конкретным брифом и ожидаемой формой вывода.",
      "  3. Получив результаты, синтезируй: что подтверждено, что противоречит, где пробелы.",
      "  4. Цитируй источники с URL и датой (если доступна). Не выдумывай ссылки.",
      "  5. В конце предложи: (а) сохранить ключевые факты в KB (`<<reflex:kb>>` kind=\"research-note\"), (б) собрать виджет news-list/link-list.",
      "  6. Если данных мало — открыто скажи об этом и предложи следующие шаги.",
    ].join("\n"),
  },
  {
    id: "widget-builder",
    title: "Widget builder",
    description:
      "Помощник создания виджетов — подсказывает kind и формат данных.",
    author: "builtin",
    instructions: [
      "## Skill: widget-builder",
      "",
      "Ты помогаешь спроектировать и собрать виджет:",
      "  1. Уточни через `<<reflex:question>>` цель виджета и аудиторию (для меня одного / для команды / отчёт).",
      "  2. Подбери оптимальный `kind` — обоснуй выбор вслух (1 строкой).",
      "  3. Если для виджета нужны данные — собери их через WebFetch/WebSearch/Read до эмита.",
      "  4. Эмить ровно один `<<reflex:widget-create>>` маркер, с продуманным `id` и `refresh` cadence.",
      "  5. Подскажи пользователю как редактировать виджет (карандашик → этот же топик).",
    ].join("\n"),
  },
  {
    id: "kb-curator",
    title: "KB curator",
    description:
      "Структурирует сырой контент в чистые KB-заметки с правильным kind и meta.",
    author: "builtin",
    instructions: [
      "## Skill: kb-curator",
      "",
      "Ты — куратор базы знаний. Каждый вход — заметка, факт, или ссылка — превращай в аккуратную KB-запись:",
      "  1. Определи `kind` (fact | task | meeting | product | person | place | event | …). Если неоднозначно — спроси.",
      "  2. Заголовок: 4-9 слов, без кавычек, без точки в конце.",
      "  3. `meta`: уложи структурированные поля (даты ISO, ссылки, теги). НЕ дублируй их в body.",
      "  4. `body`: что не влезло в meta — контекст, нюансы, цитаты с источниками.",
      "  5. Эмить `<<reflex:kb>>` маркер; не пиши Write — manager сам кладёт в правильную папку.",
      "  6. Если запись добавляется к существующей теме — упомяни рядом-файлы через @-mentions в чате (для контекста, не для агента).",
    ].join("\n"),
  },
];

export async function listSkills(): Promise<SkillMeta[]> {
  const user = await listUserSkills();
  const seen = new Set<string>(user.map((s) => s.id));
  const builtin = BUILTIN.filter((s) => !seen.has(s.id)).map(
    ({ instructions: _i, ...m }) => {
      void _i;
      return m;
    },
  );
  return [...user.map(({ instructions: _i, ...m }) => {
    void _i;
    return m;
  }), ...builtin];
}

async function listUserSkills(): Promise<Skill[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(USER_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(path.join(USER_DIR, e.name), "utf8");
      const parsed = matter(raw);
      const data = parsed.data as Partial<Skill>;
      const id = typeof data.id === "string" ? data.id : null;
      if (!id) continue;
      out.push({
        id,
        title: typeof data.title === "string" ? data.title : id,
        description:
          typeof data.description === "string" ? data.description : "",
        author: "user",
        instructions: parsed.content.trim(),
      });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function loadSkill(id: string): Promise<Skill | null> {
  const user = await listUserSkills();
  const hit = user.find((s) => s.id === id);
  if (hit) return hit;
  return BUILTIN.find((s) => s.id === id) ?? null;
}
