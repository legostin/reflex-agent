import type { SpaceTemplate } from "./registry";

/**
 * "Study" — courses, study notes, knowledge tracking. The skill prompts
 * the agent to digest readings into Anki-style flashcards and weekly
 * recall reviews.
 */
export const studyTemplate: SpaceTemplate = {
  id: "study",
  label: "Study",
  emoji: "🎓",
  description:
    "Courses, notes, spaced repetition. Drop in an article — Reflex makes a summary and review cards.",
  defaultFolder: "Study",
  build: () => ({
    widgets: [
      {
        id: "study-current-courses",
        title: "Current courses",
        description: "What I'm studying now",
        payload: {
          kind: "progress",
          data: {
            items: [],
          },
        },
      },
      {
        id: "study-weekly-checklist",
        title: "This week",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Complete 1 lesson", done: false },
              { text: "Do 5 reviews", done: false },
              { text: "Write key ideas in the journal", done: false },
            ],
          },
        },
      },
      {
        id: "study-recent-notes",
        title: "Recent notes",
        payload: {
          kind: "kb-pinned",
          data: { items: [] },
        },
      },
    ],
    topics: [
      {
        message:
          "Hi! I'll help you study: drop in links to articles, videos, or books — I'll make summaries and review cards. Tell me what you're studying right now.",
      },
    ],
    skills: [
      {
        id: "study-helper",
        title: "Study helper",
        description: "Makes summaries, review cards, tracks courses",
        instructions: [
          "## Study helper",
          "",
          "You are a study curator. When the user shares material:",
          "  1. Write a note to the KB via `<<reflex:kb>>` with `kind: \"note\"|\"flashcard\"|\"course\"`.",
          "  2. For long material — assemble a summary (3-5 key points) + 3-5 flashcard questions.",
          "  3. If a course/subject is mentioned — update `study-current-courses` (progress).",
          "  4. Add a fresh note to `study-recent-notes` (kb-pinned).",
          "  5. Once a week, suggest reviewing old cards (spaced-repetition style).",
        ].join("\n"),
      },
    ],
  }),
};
