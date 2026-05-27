import { reflex } from "@host/api";
import type { TutorQA } from "./tutorAsk";
import { callJsonAgent, snippet } from "./_json";
import { writeCourse } from "./_store";

/**
 * Build a course outline based on topic + wizard answers. Returns a
 * list of 5-9 modules each with a short title, a 1-sentence objective,
 * and an estimated duration. The course record is persisted as a KB
 * entry of kind="course"; subsequent buildModule calls hang content
 * off it module-by-module.
 */

export interface OutlineModule {
  id: string;
  title: string;
  objective: string;
  estMinutes: number;
}

export interface GenerateOutlineArgs {
  topic: string;
  history: TutorQA[];
}

export interface CourseRecord {
  courseId: string;
  topic: string;
  modules: OutlineModule[];
  relPath: string;
  createdAt: string;
}

export default async function generateOutline(
  args: GenerateOutlineArgs,
): Promise<CourseRecord> {
  const prior = args.history
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join("\n\n");
  const prompt = [
    "Составь учебный курс по теме «${TOPIC}» под пользователя с такими ответами:".replace(
      "${TOPIC}",
      args.topic,
    ),
    "",
    prior || "(нет ответов)",
    "",
    "Требования:",
    "  • 5-9 модулей, от базовых к продвинутым.",
    "  • Каждый модуль самодостаточен (можно открыть и пройти за один присест).",
    "  • objective — одна точная фраза «к концу модуля ты сможешь …».",
    "  • estMinutes — реалистичная оценка чистого времени учёбы (15-60).",
    "  • id модуля — kebab-case, латиница+цифры.",
    "Верни ТОЛЬКО JSON одной строкой, без markdown:",
    `  {"modules":[{"id":"intro","title":"…","objective":"…","estMinutes":30}, ...]}`,
  ].join("\n");

  const result = await callJsonAgent<OutlineModule[]>({
    prompt,
    invoke: (p) => reflex.agent.invoke({ prompt: p, timeoutMs: 4 * 60_000 }),
    maxAttempts: 4,
    shapeHint:
      `{"modules":[{"id":"intro","title":"Введение","objective":"к концу модуля сможешь …","estMinutes":30}, ...]}\n` +
      `Минимум 5 модулей. id — kebab-case, без пробелов и кириллицы.`,
    validate: (parsed) => {
      const v = parsed as { modules?: unknown };
      const modules = sanitizeModules(v?.modules);
      return modules.length > 0 ? modules : null;
    },
  });

  if (!result.ok) {
    throw new Error(
      `Не удалось собрать программу курса за ${result.attempts} попыток (${result.reason}). ` +
        `Последний ответ агента: «${snippet(result.lastText, 200)}». Попробуй переформулировать тему.`,
    );
  }
  const modules = result.value;

  const courseId = slugify(args.topic) || `course-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const body = [
    `# ${args.topic}`,
    "",
    "## Программа",
    "",
    ...modules.map(
      (mod, i) =>
        `${i + 1}. **${mod.title}** — ${mod.objective} (~${mod.estMinutes} мин)`,
    ),
  ].join("\n");

  const nowIso = new Date().toISOString();
  // Source of truth: sandboxed JSON. Lookup via fs.list — no YAML
  // round-tripping headaches.
  await writeCourse({
    courseId,
    topic: args.topic,
    modules,
    progress: {},
    wizardAnswers: args.history,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  // KB entry is for human visibility (showing up in the KB tree with a
  // "createdBy: utility" badge). Short meta only — no JSON-stringified
  // blobs, so multi-line YAML never happens.
  const saved = await reflex.kb.add({
    kind: "course",
    title: args.topic,
    body,
    meta: {
      courseId,
      topic: args.topic,
      modulesCount: modules.length,
      createdAt: today,
    },
    slug: courseId,
    date: today,
  });

  await reflex.audit.log({
    type: "course-outlined",
    payload: { topic: args.topic, modulesCount: modules.length },
  });

  return {
    courseId,
    topic: args.topic,
    modules,
    relPath: saved.relPath,
    createdAt: today,
  };
}

function sanitizeModules(raw: unknown): OutlineModule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OutlineModule[] = [];
  for (const m of raw) {
    if (typeof m !== "object" || m === null) continue;
    const o = m as Partial<OutlineModule>;
    const id =
      typeof o.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(o.id)
        ? o.id
        : slugify(typeof o.title === "string" ? o.title : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: typeof o.title === "string" ? o.title : id,
      objective: typeof o.objective === "string" ? o.objective : "",
      estMinutes:
        typeof o.estMinutes === "number" && Number.isFinite(o.estMinutes)
          ? Math.max(5, Math.min(180, Math.round(o.estMinutes)))
          : 30,
    });
  }
  return out;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
