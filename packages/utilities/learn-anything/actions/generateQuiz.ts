import { reflex } from "@host/api";
import { extractJson } from "./_json";

/**
 * Generate a 5-question multiple-choice quiz for a module. Each item:
 * stem (question), 4 options, one correct index, explanation. Quiz
 * isn't persisted as a separate KB entry — it's transient state the UI
 * holds while the user takes it; the score lands in course.meta.progress
 * after completion.
 */

export interface QuizQuestion {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface GenerateQuizArgs {
  moduleTitle: string;
  moduleObjective: string;
  /** Article body — gives the LLM something to draw questions from. */
  article: string;
}

export default async function generateQuiz(
  args: GenerateQuizArgs,
): Promise<{ questions: QuizQuestion[] }> {
  const trimmed = (args.article ?? "").slice(0, 6000);
  const prompt = [
    `Модуль: «${args.moduleTitle}» — ${args.moduleObjective}.`,
    "Составь короткий тест-проверку из 5 вопросов с 4 вариантами ответа.",
    "Правила:",
    "  • Вопросы — на понимание, не на запоминание мелочей.",
    "  • Только один правильный ответ; остальные правдоподобные.",
    "  • Объяснение почему правильный — 1-2 фразы.",
    "Верни ТОЛЬКО JSON одной строкой:",
    `  {"questions":[{"stem":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}, ...]}`,
    "",
    `## Материал модуля\n${trimmed}`,
  ].join("\n");

  const r = await reflex.llm.complete({ task: "quick", prompt });
  const parsed = extractJson<{ questions?: unknown[] }>(r.text);
  if (!parsed) return { questions: [] };
  try {
    const out: QuizQuestion[] = [];
    for (const q of parsed.questions ?? []) {
      if (typeof q !== "object" || q === null) continue;
      const o = q as Partial<QuizQuestion>;
      if (
        typeof o.stem !== "string" ||
        !Array.isArray(o.options) ||
        o.options.length < 2 ||
        typeof o.correctIndex !== "number" ||
        o.correctIndex < 0 ||
        o.correctIndex >= o.options.length
      ) {
        continue;
      }
      out.push({
        stem: o.stem,
        options: o.options.map((x) => String(x)).slice(0, 6),
        correctIndex: o.correctIndex,
        explanation: typeof o.explanation === "string" ? o.explanation : "",
      });
    }
    return { questions: out.slice(0, 8) };
  } catch {
    return { questions: [] };
  }
}
