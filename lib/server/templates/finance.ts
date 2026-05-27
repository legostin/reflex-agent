import type { SpaceTemplate } from "./registry";

/**
 * "Finance" — personal money tracking starter. KPI tile for monthly
 * spend + budget, checklist for monthly money habits, progress bars for
 * savings goals. The dedicated skill teaches the agent to log every "I
 * bought X for Y" as a structured KB entry and update the KPI widget.
 */
export const financeTemplate: SpaceTemplate = {
  id: "finance",
  label: "Finance",
  emoji: "💰",
  description:
    "Track expenses and income, monthly budget, savings goals. Say \"bought X for Y\" and Reflex sorts it into the cards.",
  defaultFolder: "Finance",
  build: () => ({
    widgets: [
      {
        id: "finance-month-kpi",
        title: "This month",
        description: "Income, expenses, remaining budget",
        payload: {
          kind: "kpi",
          data: {
            items: [
              { label: "Expenses", value: "0 ₽", delta: "flat" },
              { label: "Income", value: "0 ₽", delta: "flat" },
              { label: "Budget remaining", value: "0 ₽", hint: "of the monthly" },
            ],
          },
        },
      },
      {
        id: "finance-savings-goals",
        title: "Savings goals",
        description: "What we're saving for",
        payload: {
          kind: "progress",
          data: {
            items: [
              { label: "Emergency fund", current: 0, target: 100000, unit: "₽" },
            ],
          },
        },
      },
      {
        id: "finance-habits",
        title: "Financial habits",
        description: "Monthly habits — tick them off as you complete them",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Review the budget", done: false },
              { text: "Log major expenses", done: false },
              { text: "Move money to savings", done: false },
            ],
          },
        },
      },
    ],
    topics: [
      {
        message:
          "Hi! I'll help you manage finances. Tell me about any purchase, income, or goal — I'll put it in the right card. For example: \"bought groceries for 1200\" or \"salary 80000\".",
      },
    ],
    skills: [
      {
        id: "finance-helper",
        title: "Finance helper",
        description: "Sorts purchases and income into KPI/Progress cards",
        instructions: [
          "## Finance helper",
          "",
          "You are a personal finance assistant. When the user writes about money:",
          "  1. Recognize the type: expense / income / goal.",
          "  2. Save the fact to the KB via `<<reflex:kb>>` with `kind: \"expense\"|\"income\"|\"goal\"` and `meta.amount`, `meta.currency`, `meta.category`, `meta.date`.",
          "  3. Update the corresponding card via `<<reflex:widget-update>>`:",
          "     - `finance-month-kpi`: recompute expenses/income for the current month from the KB.",
          "     - `finance-savings-goals`: advance progress on the matching goal.",
          "  4. In chat — a short confirmation: \"Logged expense 1200 ₽ — groceries\". Nothing extra.",
          "  5. If the category is ambiguous (e.g. just \"1500\") — ask via `<<reflex:question>>`.",
        ].join("\n"),
      },
    ],
  }),
};
