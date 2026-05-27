import type { SpaceTemplate } from "./registry";

/**
 * "Путешествия" — trip planning + travel diary. Map widget naturally
 * fits here (points of interest, route, deep-links to Yandex/Google).
 * The skill keeps trip-prep checklists organized.
 */
export const travelTemplate: SpaceTemplate = {
  id: "travel",
  label: "Путешествия",
  emoji: "✈️",
  description:
    "Планирование поездок, точки на карте, маршруты, чек-листы перед вылетом. Дневник впечатлений.",
  defaultFolder: "Путешествия",
  build: () => ({
    widgets: [
      {
        id: "travel-map",
        title: "Места",
        description: "Точки на карте — добавь свои города и POI",
        payload: {
          kind: "map",
          data: { points: [] },
        },
      },
      {
        id: "travel-prep-checklist",
        title: "Сборы перед поездкой",
        payload: {
          kind: "checklist",
          data: {
            items: [
              { text: "Загранпаспорт ≥ 6 мес.", done: false },
              { text: "Билеты", done: false },
              { text: "Жильё забронировано", done: false },
              { text: "Страховка", done: false },
              { text: "Зарядки и адаптеры", done: false },
              { text: "Лекарства первой необходимости", done: false },
            ],
          },
        },
      },
      {
        id: "travel-trips",
        title: "Планы поездок",
        description: "Куда и когда",
        payload: {
          kind: "link-list",
          data: { items: [] },
        },
      },
    ],
    topics: [
      {
        message:
          "Я помогу спланировать поездки. Расскажи, куда хочешь поехать — добавлю точки на карту, соберу чек-лист сборов и предложу маршрут.",
      },
    ],
    skills: [
      {
        id: "travel-helper",
        title: "Помощник путешественника",
        description: "Планирует поездки, ведёт карту мест, дневник впечатлений",
        instructions: [
          "## Помощник путешественника",
          "",
          "Ты помогаешь планировать и переживать путешествия:",
          "  1. Когда упомянут город / POI — найди координаты (WebSearch/WebFetch geocoding, не выдумывай) и обнови `travel-map` через `<<reflex:widget-update>>`.",
          "  2. Когда планируется поездка — добавь её в `travel-trips` (link-list) и проверь `travel-prep-checklist`.",
          "  3. После поездки — спроси про впечатления и сохрани в KB как `kind: \"trip-log\"` с meta.dates, meta.country, meta.cities.",
          "  4. Перед вылетом за N дней (если знаешь дату) — напомни про чек-лист.",
        ].join("\n"),
      },
    ],
  }),
};
