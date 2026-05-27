import type { SpaceTemplate } from "./registry";

/**
 * "Health" — daily habits, supplements/medications schedule, weight
 * tracking. The agent learns to log meals/workouts/symptoms into KB and
 * roll them up into the dashboard.
 */
export const healthTemplate: SpaceTemplate = {
  id: "health",
  label: "Health",
  emoji: "🩺",
  description:
    "Daily habits, vitamins, workouts, symptoms. Say \"took vitamin D\" — it gets ticked off in the checklist.",
  defaultFolder: "Health",
  build: () => ({
    widgets: [
      {
        id: "health-daily-habits",
        title: "Daily habits",
        description: "Today's checklist",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Vitamin D", done: false },
              { text: "2 liters of water", done: false },
              { text: "30-minute walk", done: false },
              { text: "Exercise", done: false },
            ],
          },
        },
      },
      {
        id: "health-kpi",
        title: "Health — summary",
        payload: {
          kind: "kpi",
          data: {
            items: [
              { label: "Weight", value: "—", hint: "update once a week" },
              { label: "Steps (today)", value: "0" },
              { label: "Sleep", value: "—", hint: "hours last night" },
            ],
          },
        },
      },
      {
        id: "health-goals",
        title: "Long-term goals",
        payload: {
          kind: "progress",
          data: {
            items: [
              { label: "Run 3 times a week", current: 0, target: 3, unit: "times" },
            ],
          },
        },
      },
    ],
    topics: [
      {
        message:
          "Tell me about your habits and health goals. I'll track progress. Say \"took a vitamin\", \"slept 8 hours\", \"weight 72\" — I'll sort it into the cards.",
      },
    ],
    skills: [
      {
        id: "health-helper",
        title: "Health helper",
        description: "Logs habits, sleep, weight, workouts",
        instructions: [
          "## Health helper",
          "",
          "You help maintain a healthy lifestyle. When the user writes about habits/health:",
          "  1. Recognize: habit check / measurement (weight, sleep, steps) / workout / symptom / vitamin.",
          "  2. Write to the KB via `<<reflex:kb>>` with `kind: \"habit\"|\"measurement\"|\"workout\"|\"symptom\"` and `meta.date`, `meta.value`, `meta.unit`.",
          "  3. Update the cards:",
          "     - `health-daily-habits`: tick the box for the mentioned item (if it doesn't exist — add it).",
          "     - `health-kpi`: update the value for weight/sleep/steps.",
          "     - `health-goals`: advance the counter for the mentioned goal.",
          "  4. In chat — a short supportive confirmation. No moralizing.",
          "  5. If something was skipped (yesterday a habit wasn't mentioned) — don't scold; a gentle reminder is fine.",
        ].join("\n"),
      },
    ],
  }),
};
