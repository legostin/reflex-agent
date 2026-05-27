import type { SpaceTemplate } from "./registry";

/**
 * "Здоровье" — daily habits, supplements/medications schedule, weight
 * tracking. The agent learns to log meals/workouts/symptoms into KB and
 * roll them up into the dashboard.
 */
export const healthTemplate: SpaceTemplate = {
  id: "health",
  label: "Здоровье",
  emoji: "🩺",
  description:
    "Привычки дня, витамины, тренировки, симптомы. Скажи «принял витамин D» — отметится в чек-листе.",
  defaultFolder: "Здоровье",
  build: () => ({
    widgets: [
      {
        id: "health-daily-habits",
        title: "Привычки дня",
        description: "Чек-лист на сегодня",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Витамин D", done: false },
              { text: "2 литра воды", done: false },
              { text: "Прогулка 30 минут", done: false },
              { text: "Зарядка", done: false },
            ],
          },
        },
      },
      {
        id: "health-kpi",
        title: "Здоровье — сводка",
        payload: {
          kind: "kpi",
          data: {
            items: [
              { label: "Вес", value: "—", hint: "обнови раз в неделю" },
              { label: "Шаги (сегодня)", value: "0" },
              { label: "Сон", value: "—", hint: "часов вчера" },
            ],
          },
        },
      },
      {
        id: "health-goals",
        title: "Долгосрочные цели",
        payload: {
          kind: "progress",
          data: {
            items: [
              { label: "Бегать 3 раза в неделю", current: 0, target: 3, unit: "раз" },
            ],
          },
        },
      },
    ],
    topics: [
      {
        message:
          "Расскажи мне о своих привычках и целях по здоровью. Я буду отмечать прогресс. Пиши «принял витамин», «поспал 8 часов», «вес 72» — я разнесу по карточкам.",
      },
    ],
    skills: [
      {
        id: "health-helper",
        title: "Помощник по здоровью",
        description: "Логирует привычки, сон, вес, тренировки",
        instructions: [
          "## Помощник по здоровью",
          "",
          "Ты помогаешь вести здоровый образ жизни. Когда пользователь пишет про привычки/здоровье:",
          "  1. Распознай: привычка-чек / измерение (вес, сон, шаги) / тренировка / симптом / витамин.",
          "  2. Запиши в KB через `<<reflex:kb>>` с `kind: \"habit\"|\"measurement\"|\"workout\"|\"symptom\"` и `meta.date`, `meta.value`, `meta.unit`.",
          "  3. Обнови карточки:",
          "     - `health-daily-habits`: тыкни галку для упомянутого пункта (если не существует — добавь).",
          "     - `health-kpi`: обнови value для веса/сна/шагов.",
          "     - `health-goals`: продвинь counter для упомянутой цели.",
          "  4. В чате — поддерживающее короткое подтверждение. Без морализаторства.",
          "  5. Если есть пропуск (вчера не упомянули привычку) — не упрекай, можно мягко напомнить.",
        ].join("\n"),
      },
    ],
  }),
};
