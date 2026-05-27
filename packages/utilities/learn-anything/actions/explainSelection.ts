import { reflex } from "@host/api";

/**
 * "Explain this" feature: user highlights a snippet inside the module
 * article and asks for a deeper explanation. The agent gets the
 * surrounding paragraph as context so it understands what "это" means.
 *
 * Two modes:
 *   1. Default — `question` omitted, agent gives a generic 2-5 paragraph
 *      breakdown of the selected fragment.
 *   2. Custom — `question` supplied (book-style margin annotation), agent
 *      answers that specific question with the selection as the focal
 *      point. Lets the reader say things like "при чём тут N?" or
 *      "дай пример" instead of always getting the same boilerplate.
 */

export interface ExplainSelectionArgs {
  selection: string;
  /** ~400-1000 chars around the selection for context. */
  context: string;
  topic: string;
  moduleTitle: string;
  /** Optional user question about the selection. */
  question?: string;
}

export default async function explainSelection(
  args: ExplainSelectionArgs,
): Promise<{ text: string }> {
  const userQuestion = (args.question ?? "").trim();
  const promptLines: string[] = [
    `Курс: «${args.topic}». Модуль: «${args.moduleTitle}».`,
  ];

  if (userQuestion) {
    promptLines.push(
      "Пользователь выделил фрагмент и задал конкретный вопрос про этот фрагмент.",
      "Ответь именно на его вопрос, опираясь на выделение + окружающий контекст. 2-4 абзаца, без воды, по делу.",
      "Markdown без заголовков; короткие фразы, пример если уместен.",
    );
  } else {
    promptLines.push(
      "Пользователь выделил фрагмент и просит объяснить подробнее.",
      "Дай развёрнутое объяснение в 2-5 абзацах: что это значит, как работает,",
      "почему именно так, конкретный пример. Без воды. Markdown без заголовков.",
    );
  }

  promptLines.push(
    "",
    `## Окружающий контекст\n${args.context.slice(0, 1500)}`,
    "",
    `## Выделение пользователя\n«${args.selection.slice(0, 800)}»`,
  );
  if (userQuestion) {
    promptLines.push("", `## Вопрос пользователя\n${userQuestion.slice(0, 600)}`);
  }

  const r = await reflex.llm.complete({
    task: "quick",
    prompt: promptLines.join("\n"),
  });
  return { text: (r.text ?? "").trim() };
}
