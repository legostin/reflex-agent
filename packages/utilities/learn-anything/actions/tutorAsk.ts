import { reflex } from "@host/api";
import { extractJson } from "./_json";

/**
 * Wizard step. Given the topic + prior Q&A, the agent decides whether
 * it needs more context or has enough to design a course. Returns
 * either the next question (open-ended or multiple-choice) or
 * `{done:true}` so the UI advances to outline generation.
 *
 * Keeping the wizard agent-driven means we don't hardcode "3 questions
 * about level/focus/format" — for "хочу научиться рисовать карандашом"
 * the agent will ask different questions than for "хочу выучить
 * Python". The UI just renders whatever comes back.
 */

export interface TutorQA {
  question: string;
  answer: string;
}

export interface TutorAskArgs {
  topic: string;
  history: TutorQA[];
  /** Force-finish even if the agent wants more. UI uses this when the
   *  user clicks "Хватит вопросов — давай уже курс". */
  forceFinish?: boolean;
}

export interface TutorAskResult {
  done: boolean;
  /** Free-form question; UI renders a textarea. */
  question?: string;
  /** Optional pre-baked choices for a multiple-choice ask. */
  choices?: string[];
  /** Hint to UI: short label like "уровень", "формат", "цель". */
  header?: string;
}

const MAX_TURNS = 5;

export default async function tutorAsk(
  args: TutorAskArgs,
): Promise<TutorAskResult> {
  const turns = args.history.length;
  if (args.forceFinish || turns >= MAX_TURNS) {
    return { done: true };
  }

  const prior = args.history
    .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
    .join("\n\n");

  const prompt = [
    "Ты — наставник, который собирается составить персональный курс для пользователя.",
    `Тема: «${args.topic}».`,
    "Тебе нужно собрать минимум информации, чтобы хорошо подобрать программу: уровень, цель, время, формат, специфика.",
    "Задавай по ОДНОМУ вопросу за раз. Решай сам какой именно — то что важнее всего сейчас, исходя из темы и предыдущих ответов.",
    "Если есть смысл предложить варианты ответа — добавь до 5 коротких choices.",
    "Если ты уже знаешь достаточно (обычно после 2-4 вопросов) — верни done=true.",
    "Ответь ТОЛЬКО JSON одной строкой, без markdown:",
    `  {"done":false,"question":"...","header":"уровень|цель|время|формат|...","choices":["...","..."]}`,
    "  или",
    `  {"done":true}`,
    "",
    prior ? `## Предыдущие ответы\n${prior}` : "## Это первый вопрос",
    `\nЗадано вопросов до сих пор: ${turns} (максимум ${MAX_TURNS}).`,
  ].join("\n");

  const r = await reflex.llm.complete({ task: "quick", prompt });
  const parsed = extractJson<TutorAskResult>(r.text);
  if (!parsed) return { done: true };
  try {
    if (parsed.done) return { done: true };
    if (typeof parsed.question !== "string" || !parsed.question.trim()) {
      return { done: true };
    }
    return {
      done: false,
      question: parsed.question.trim(),
      ...(parsed.header ? { header: parsed.header } : {}),
      ...(Array.isArray(parsed.choices) && parsed.choices.length > 0
        ? {
            choices: parsed.choices
              .map((c) => String(c).trim())
              .filter(Boolean)
              .slice(0, 5),
          }
        : {}),
    };
  } catch {
    return { done: true };
  }
}
