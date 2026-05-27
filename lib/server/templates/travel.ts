import type { SpaceTemplate } from "./registry";

/**
 * "Travel" — trip planning + travel diary. Map widget naturally
 * fits here (points of interest, route, deep-links to Yandex/Google).
 * The skill keeps trip-prep checklists organized.
 */
export const travelTemplate: SpaceTemplate = {
  id: "travel",
  label: "Travel",
  emoji: "✈️",
  description:
    "Trip planning, map points, routes, pre-flight checklists. Diary of impressions.",
  defaultFolder: "Travel",
  build: () => ({
    widgets: [
      {
        id: "travel-map",
        title: "Places",
        description: "Points on the map — add your cities and POIs",
        payload: {
          kind: "map",
          data: { points: [] },
        },
      },
      {
        id: "travel-prep-checklist",
        title: "Pre-trip packing",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Passport valid ≥ 6 months", done: false },
              { text: "Tickets", done: false },
              { text: "Lodging booked", done: false },
              { text: "Insurance", done: false },
              { text: "Chargers and adapters", done: false },
              { text: "Essential medications", done: false },
            ],
          },
        },
      },
      {
        id: "travel-trips",
        title: "Trip plans",
        description: "Where and when",
        payload: {
          kind: "link-list",
          data: { items: [] },
        },
      },
    ],
    topics: [
      {
        message:
          "I'll help plan your trips. Tell me where you want to go — I'll add points to the map, assemble a packing checklist, and suggest a route.",
      },
    ],
    skills: [
      {
        id: "travel-helper",
        title: "Travel helper",
        description: "Plans trips, maintains a map of places, diary of impressions",
        instructions: [
          "## Travel helper",
          "",
          "You help plan and live through travels:",
          "  1. When a city / POI is mentioned — find the coordinates (WebSearch/WebFetch geocoding; don't invent) and update `travel-map` via `<<reflex:widget-update>>`.",
          "  2. When a trip is planned — add it to `travel-trips` (link-list) and review `travel-prep-checklist`.",
          "  3. After the trip — ask about impressions and save to the KB as `kind: \"trip-log\"` with meta.dates, meta.country, meta.cities.",
          "  4. N days before departure (if you know the date) — remind about the checklist.",
        ].join("\n"),
      },
    ],
  }),
};
