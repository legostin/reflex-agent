/**
 * A widget = a small, structured result of an agent's work that lives on
 * the project dashboard. Each widget has:
 *   - a stable `id` (kebab-case) so layout can reference it
 *   - a `kind` from a closed enum — Reflex has a built-in renderer per kind
 *   - a `data` blob whose shape is dictated by the kind
 *   - a `sourceTopicId` so the user can "edit via chat" — clicking the
 *     pencil re-opens the originating topic and they ask the agent to
 *     refresh the data.
 *
 * Widgets are stored as one JSON file per id in `<root>/.reflex/widgets/`,
 * dashboard layout (order, visible/hidden) in `dashboard-layout.json`
 * alongside. Both are diff-friendly and survive HMR.
 */

export type WidgetKind =
  | "markdown"
  | "news-list"
  | "link-list"
  | "kpi"
  | "checklist"
  | "quote"
  | "kb-pinned"
  | "progress"
  | "image"
  | "stat-table"
  | "map"
  | "action-list"
  | "utility-card";

export interface MarkdownData {
  body: string;
}

export interface NewsListData {
  items: Array<{
    title: string;
    url?: string;
    summary?: string;
    source?: string;
    date?: string;
    /** Set when the user clicks "read" — dims the row, agent
     *  can use this in dedup memory on the next refresh. */
    read?: boolean;
  }>;
}

export interface LinkListData {
  items: Array<{
    title: string;
    url: string;
    hint?: string;
  }>;
}

export interface KpiData {
  items: Array<{
    label: string;
    value: string | number;
    hint?: string;
    /** Arrow direction for "vs prior period" hint. */
    delta?: "up" | "down" | "flat";
  }>;
}

export interface ChecklistData {
  items: Array<{
    text: string;
    done?: boolean;
  }>;
}

export interface QuoteData {
  text: string;
  attribution?: string;
}

export interface KbPinnedData {
  items: Array<{
    rel: string;
    title?: string;
    snippet?: string;
  }>;
}

export interface ProgressData {
  items: Array<{
    label: string;
    current: number;
    target: number;
    unit?: string;
  }>;
}

export interface ImageData {
  url: string;
  alt?: string;
  caption?: string;
}

export interface StatTableData {
  /** Optional column headers (rendered <th>). */
  columns?: string[];
  rows: Array<string[]>;
}

/**
 * A grouped, optionally-interactive list. Each item can carry ONE action
 * that invokes a server action of the utility this widget belongs to —
 * the renderer wires the button to the host so e.g. a task card can
 * "Send to agent" without opening the mini-app. Action buttons only
 * appear when the widget has a utility context (i.e. it's the inner of a
 * `utility-card`) and the dashboard isn't in readonly/share mode.
 */
export interface ActionListItem {
  /** Stable id — passed back in the action args by convention. */
  id: string;
  title: string;
  subtitle?: string;
  /** Small leading tag — task type, emoji, status, etc. */
  badge?: string;
  action?: {
    label: string;
    /** Name of a server action declared in the utility's manifest. */
    actionName: string;
    /** Extra args merged into the action call (e.g. {id}). */
    args?: Record<string, unknown>;
    /** When set, the UI confirms with this text before invoking. */
    confirm?: string;
  };
}

export interface ActionListGroup {
  label: string;
  /** Shown when the group has no items. */
  emptyText?: string;
  items: ActionListItem[];
}

export interface ActionListData {
  groups: ActionListGroup[];
}

export interface MapPoint {
  lat: number;
  lng: number;
  title: string;
  description?: string;
  /** Optional marker color hint (CSS color or named: red/blue/green/etc.). */
  color?: string;
}

export interface MapRoute {
  /** Ordered list of indices into `points`. Renders as a polyline and
   *  feeds the multi-waypoint deep-links per service. >=2 indices. */
  stops: number[];
  /** Optional polyline color (CSS color). Defaults to violet. */
  color?: string;
  /** Optional travel mode hint (currently informational, not yet used by every provider URL). */
  mode?: "car" | "walk" | "bike" | "transit";
}

export interface MapData {
  /** Map center. If omitted, auto-fit to all points. */
  center?: { lat: number; lng: number };
  /** Zoom level (1 = world, 18 = street). Default auto-fit. */
  zoom?: number;
  points: MapPoint[];
  /** Optional route across the points (indices). */
  route?: MapRoute;
}

/**
 * Card that wraps another widget kind to bind it to a utility. The host
 * dispatches to the inner kind's renderer for visuals; the wrapper adds
 * the utility's name + an "Open" link to the full page. Data is
 * declared in the utility's `manifest.card` and refreshed by the utility
 * itself via `reflex.cards.update({snapshot})`.
 */
export interface UtilityCardData {
  utilityId: string;
  utilityScope: "global" | "project";
  /** Snapshot for the inner widget — its shape depends on `inner.kind`. */
  inner: {
    kind: Exclude<WidgetKind, "utility-card">;
    data: unknown;
    title?: string;
    description?: string;
  };
}

export type WidgetData =
  | { kind: "markdown"; data: MarkdownData }
  | { kind: "news-list"; data: NewsListData }
  | { kind: "link-list"; data: LinkListData }
  | { kind: "kpi"; data: KpiData }
  | { kind: "checklist"; data: ChecklistData }
  | { kind: "quote"; data: QuoteData }
  | { kind: "kb-pinned"; data: KbPinnedData }
  | { kind: "progress"; data: ProgressData }
  | { kind: "image"; data: ImageData }
  | { kind: "stat-table"; data: StatTableData }
  | { kind: "map"; data: MapData }
  | { kind: "action-list"; data: ActionListData }
  | { kind: "utility-card"; data: UtilityCardData };

/**
 * Visual width of a widget on the dashboard grid. Maps to col-span on a
 * 6-column base:
 *   - "sm"   → col-span-2 (3 per row on lg+)
 *   - "md"   → col-span-3 (2 per row on lg+)
 *   - "wide" → col-span-6 (full row)
 * On mobile every widget takes the full row regardless.
 */
export type WidgetSizeMode = "sm" | "md" | "wide";

export interface WidgetSize {
  /** Preferred size (agent hint or user choice). Defaults to "md". */
  mode?: WidgetSizeMode;
  /** Legacy column span — still honoured for backward compat:
   *  cols=1 → "sm", cols=2 → "md". New code should write `mode` instead. */
  cols?: 1 | 2 | 3;
}

export function resolveSizeMode(size?: WidgetSize): WidgetSizeMode {
  if (size?.mode) return size.mode;
  if (size?.cols === 1) return "sm";
  if (size?.cols === 2) return "md";
  if (size?.cols === 3) return "wide";
  return "md";
}

export const SIZE_TO_COL_SPAN: Record<WidgetSizeMode, number> = {
  sm: 2,
  md: 3,
  wide: 6,
};

/**
 * How often the scheduler should auto-refresh the widget by re-running the
 * agent on the source topic. "manual" (default) means refresh only happens
 * when the user explicitly asks in chat or clicks "Refresh now".
 */
export type WidgetRefresh = "manual" | "hourly" | "daily" | "weekly";

export const REFRESH_CADENCE_MS: Record<
  Exclude<WidgetRefresh, "manual">,
  number
> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export type WidgetRecord = WidgetData & {
  id: string;
  title: string;
  description?: string;
  /** Topic that created (or last edited) this widget. Pencil → /chat/<id>. */
  sourceTopicId?: string;
  /** When the agent last wrote/refreshed the data. */
  updatedAt: string;
  createdAt: string;
  size?: WidgetSize;
  /** Auto-refresh cadence; defaults to "manual" when missing. */
  refresh?: WidgetRefresh;
  /**
   * Last time the auto-scheduler ran a refresh turn (success or failure).
   * Separate from `updatedAt` so the scheduler can debounce by attempts,
   * not by successful writes (avoids hammering on persistent failures).
   */
  lastRefreshAt?: string;
  /**
   * Inline agent-managed memory. Used for short structured state — e.g.
   * "shown URLs" for news, "prior KPI values" for charts. Agent reads it
   * in the refresh prompt and emits an updated value in `widget-update`.
   * Keep under ~2KB; for larger history use `memoryFile`.
   */
  memory?: string;
  /**
   * Rel-path (inside `<root>/.reflex/`) of a markdown file the agent
   * maintains as long-form memory — journal of OKR changes, weekly digest
   * history, etc. Versioned by git, human-editable.
   */
  memoryFile?: string;
};

/**
 * Per-root dashboard layout. `order` lists every widget id in the order
 * they should appear on the dashboard. `hidden` lists ids the user has
 * dismissed — they're still on disk, restorable from the library menu.
 *
 * System widgets (the four built-in dashboard sections) participate via
 * synthetic ids prefixed `sys:` — `sys:active-goals`, `sys:pending`,
 * `sys:recent-kb`, `sys:ai-suggestions`. They have no on-disk record.
 */
export interface DashboardLayout {
  order: string[];
  hidden: string[];
  /**
   * Per-widget size override keyed by widget id (works for both `sys:*`
   * and user widgets). Overrides whatever `size.mode` the widget record
   * itself carries — user-pinned size beats agent suggestion.
   */
  sizes?: Record<string, WidgetSizeMode>;
}

export const SYSTEM_WIDGET_IDS = [
  "sys:active-goals",
  "sys:pending",
  "sys:recent-kb",
  "sys:ai-suggestions",
] as const;

export type SystemWidgetId = (typeof SYSTEM_WIDGET_IDS)[number];

export interface SystemWidgetMeta {
  id: SystemWidgetId;
  title: string;
  description: string;
}

export const SYSTEM_WIDGETS: SystemWidgetMeta[] = [
  {
    id: "sys:active-goals",
    title: "Active goals & running agents",
    description: "Topics with an active /goal and a running orchestrator.",
  },
  {
    id: "sys:pending",
    title: "Awaiting response",
    description: "Unanswered permission / question / mcp-add cards.",
  },
  {
    id: "sys:recent-kb",
    title: "Recent in KB",
    description: "KB files modified in the last 72 hours.",
  },
  {
    id: "sys:ai-suggestions",
    title: "What's next — Reflex suggestions",
    description: "Gemini-driven analysis of project state with actions.",
  },
];

export const WIDGET_KINDS: WidgetKind[] = [
  "markdown",
  "news-list",
  "link-list",
  "kpi",
  "checklist",
  "quote",
  "kb-pinned",
  "progress",
  "image",
  "stat-table",
  "map",
  "action-list",
  "utility-card",
];
