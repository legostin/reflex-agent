import type { SpaceTemplate } from "./registry";

/**
 * "Финансы" — personal money tracking starter. KPI tile for monthly
 * spend + budget, checklist for monthly money habits, progress bars for
 * savings goals. The dedicated skill teaches the agent to log every "я
 * купил X за Y" as a structured KB entry and update the KPI widget.
 */
export const financeTemplate: SpaceTemplate = {
  id: "finance",
  label: "Финансы",
  emoji: "💰",
  description:
    "Учёт расходов и доходов, бюджет на месяц, цели накоплений. Скажи «купил Х за Y» — Reflex сам разнесёт по карточкам.",
  defaultFolder: "Финансы",
  build: () => ({
    widgets: [
      {
        id: "finance-month-kpi",
        title: "Этот месяц",
        description: "Доходы, расходы, остаток бюджета",
        payload: {
          kind: "kpi",
          data: {
            items: [
              { label: "Расходы", value: "0 ₽", delta: "flat" },
              { label: "Доходы", value: "0 ₽", delta: "flat" },
              { label: "Остаток бюджета", value: "0 ₽", hint: "из месячного" },
            ],
          },
        },
      },
      {
        id: "finance-savings-goals",
        title: "Цели накоплений",
        description: "Куда копим",
        payload: {
          kind: "progress",
          data: {
            items: [
              { label: "Подушка безопасности", current: 0, target: 100000, unit: "₽" },
            ],
          },
        },
      },
      {
        id: "finance-habits",
        title: "Финансовые привычки",
        description: "Ежемесячные привычки — отмечай по мере выполнения",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Свериться с бюджетом", done: false },
              { text: "Записать крупные расходы", done: false },
              { text: "Откладывать в копилку", done: false },
            ],
          },
        },
      },
    ],
    topics: [
      {
        message:
          "Привет! Я помогу вести финансы. Пиши о любой покупке, доходе или цели — я положу в нужную карточку. Например: «купил продукты за 1200» или «зарплата 80000».",
      },
    ],
    skills: [
      {
        id: "finance-helper",
        title: "Финансовый помощник",
        description: "Раскладывает покупки и доходы в KPI/Progress карточки",
        instructions: [
          "## Финансовый помощник",
          "",
          "Ты — помощник по личным финансам. Когда пользователь пишет про деньги:",
          "  1. Распознай тип: расход / доход / цель.",
          "  2. Сохрани факт в KB через `<<reflex:kb>>` с `kind: \"expense\"|\"income\"|\"goal\"` и `meta.amount`, `meta.currency`, `meta.category`, `meta.date`.",
          "  3. Обнови соответствующую карточку через `<<reflex:widget-update>>`:",
          "     - `finance-month-kpi`: пересчитай расходы/доходы за текущий месяц из KB.",
          "     - `finance-savings-goals`: продвинь прогресс по соответствующей цели.",
          "  4. В чате — короткое подтверждение: «Записал расход 1200 ₽ — продукты». Без лишнего.",
          "  5. Если категория неоднозначна (например «1500») — спроси через `<<reflex:question>>`.",
        ].join("\n"),
      },
    ],
  }),
};
