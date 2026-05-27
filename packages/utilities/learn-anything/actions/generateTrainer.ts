import { reflex } from "@host/api";

/**
 * Ask the agent to write an interactive trainer (small standalone HTML
 * page with inline JS) that practices a specific skill from a module —
 * e.g. simulation of a binary tree, drag-shapes-on-canvas exercise,
 * flashcard drill. The HTML runs inside a nested sandboxed iframe in
 * the utility UI; it has NO host-RPC access — strictly client-only.
 *
 * Persisted as KB kind="course-trainer" so it survives between sessions
 * and the user can re-open.
 */

export interface TrainerSpec {
  trainerId: string;
  courseId: string;
  moduleId: string;
  title: string;
  /** Self-contained HTML — head/body/script all inline. Loaded via
   *  iframe srcdoc inside the utility. */
  html: string;
  relPath: string;
}

export interface GenerateTrainerArgs {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  moduleObjective: string;
  prompt?: string; // user idea
}

export default async function generateTrainer(
  args: GenerateTrainerArgs,
): Promise<TrainerSpec> {
  const userBrief =
    (args.prompt ?? "").trim() ||
    `Спроектируй тренажёр, который помогает закрепить «${args.moduleObjective}».`;
  const prompt = [
    `Курс/модуль: «${args.moduleTitle}».`,
    "Сделай интерактивный тренажёр — отдельный HTML-файл с inline JS.",
    "Требования:",
    "  • Один <!doctype html> файл целиком: <head>, <body>, <script>, опционально <style>.",
    "  • НИКАКИХ внешних ресурсов: ни CDN-скриптов, ни картинок по URL, ни fetch'ей. Всё inline.",
    "  • Используй <canvas> где это уместно (рисование, физика, геометрия).",
    "  • Размер ≈ 600×400 px (адаптивно).",
    "  • Чёткий interface: что показано, что делать, мгновенный feedback (правильно/нет, score).",
    "  • Без navigator/window глобалов которые ломаются в sandbox iframe (без localStorage, без parent).",
    "  • КОД ДОЛЖЕН РАБОТАТЬ. Никаких placeholder-функций.",
    "Верни ТОЛЬКО HTML (без обёртки JSON и без markdown-fence).",
    "",
    `## Идея тренажёра\n${userBrief}`,
  ].join("\n");

  // Trainer HTML is long — give the agent a generous 7 minutes; worker
  // timeout (8 min in manifest) is the outer guardrail.
  const r = await reflex.agent.invoke({ prompt, timeoutMs: 7 * 60_000 });
  const text = r.text ?? "";
  const html = extractHtml(text);
  if (!html) {
    throw new Error("Агент не вернул валидный HTML — попробуй ещё раз");
  }

  const trainerId = `${args.moduleId}-${Date.now().toString(36)}`;
  const saved = await reflex.kb.add({
    kind: "course-trainer",
    title: `Тренажёр · ${args.moduleTitle}`,
    body: "```html\n" + html.slice(0, 30_000) + "\n```",
    meta: {
      courseId: args.courseId,
      moduleId: args.moduleId,
      trainerId,
      title: args.moduleTitle,
      // Full HTML in meta is bulky but allows quick re-open without re-parsing.
      // Capped at ~60KB to keep frontmatter sane.
      html: html.slice(0, 60_000),
    },
    slug: `trainer-${trainerId}`,
  });

  return {
    trainerId,
    courseId: args.courseId,
    moduleId: args.moduleId,
    title: args.moduleTitle,
    html,
    relPath: saved.relPath,
  };
}

/** Pluck HTML from possibly-fenced agent output. */
function extractHtml(text: string): string {
  // Fence-bound: ```html ... ```
  const fenced = /```(?:html)?\s*([\s\S]+?)\s*```/.exec(text);
  if (fenced) {
    const inner = fenced[1]!.trim();
    if (looksLikeHtml(inner)) return inner;
  }
  if (looksLikeHtml(text)) return text.trim();
  return "";
}

function looksLikeHtml(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes("<!doctype html") || lower.includes("<html");
}
