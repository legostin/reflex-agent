import type { SpaceTemplate } from "./registry";

/**
 * "Учёба" — courses, study notes, knowledge tracking. The skill prompts
 * the agent to digest readings into Anki-style flashcards and weekly
 * recall reviews.
 */
export const studyTemplate: SpaceTemplate = {
  id: "study",
  label: "Учёба",
  emoji: "🎓",
  description:
    "Курсы, конспекты, повторение материала. Скидываешь статью — Reflex делает выжимку и карточки для повторения.",
  defaultFolder: "Учёба",
  build: () => ({
    widgets: [
      {
        id: "study-current-courses",
        title: "Текущие курсы",
        description: "Что сейчас учу",
        payload: {
          kind: "progress",
          data: {
            items: [],
          },
        },
      },
      {
        id: "study-weekly-checklist",
        title: "На этой неделе",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Пройти 1 урок", done: false },
              { text: "Сделать 5 повторений", done: false },
              { text: "Записать ключевые мысли в дневник", done: false },
            ],
          },
        },
      },
      {
        id: "study-recent-notes",
        title: "Свежие конспекты",
        payload: {
          kind: "kb-pinned",
          data: { items: [] },
        },
      },
    ],
    topics: [
      {
        message:
          "Привет! Я помогу учиться: скидывай ссылки на статьи, видео или книги — я делаю выжимки и карточки для повторения. Расскажи, что сейчас учишь.",
      },
    ],
    skills: [
      {
        id: "study-helper",
        title: "Учебный помощник",
        description: "Делает выжимки, карточки для повторения, отслеживает курсы",
        instructions: [
          "## Учебный помощник",
          "",
          "Ты — учебный куратор. Когда пользователь делится материалом:",
          "  1. Запиши заметку в KB через `<<reflex:kb>>` с `kind: \"note\"|\"flashcard\"|\"course\"`.",
          "  2. Для длинных материалов — соберись выжимку (3-5 ключевых тезисов) + 3-5 flashcard вопросов.",
          "  3. Если упоминается курс/предмет — обнови `study-current-courses` (progress).",
          "  4. Свежий конспект — добавь в `study-recent-notes` (kb-pinned).",
          "  5. Раз в неделю предлагай повторить старые карточки (по интервальному принципу).",
        ].join("\n"),
      },
    ],
  }),
};
