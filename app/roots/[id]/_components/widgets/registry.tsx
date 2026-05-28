"use client";

import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import type { WidgetKind } from "@/lib/server/widgets/types";
import { MarkdownWidget } from "./kinds/markdown-widget";
import { NewsListWidget } from "./kinds/news-list-widget";
import { LinkListWidget } from "./kinds/link-list-widget";
import { KpiWidget } from "./kinds/kpi-widget";
import { ChecklistWidget } from "./kinds/checklist-widget";
import { QuoteWidget } from "./kinds/quote-widget";
import { KbPinnedWidget } from "./kinds/kb-pinned-widget";
import { ProgressWidget } from "./kinds/progress-widget";
import { ImageWidget } from "./kinds/image-widget";
import { StatTableWidget } from "./kinds/stat-table-widget";
import { MapWidget } from "./kinds/map-widget";
import { UtilityCardWidget } from "./kinds/utility-card-widget";

/**
 * Shared props for every widget body. `data` is the kind-specific payload;
 * each component narrows it internally. `onPatch` lets the renderer write
 * back when the user interacts (tick checklist, unpin KB file, +1 counter,
 * etc.). `readonly` mutes those affordances — used in the chat preview
 * card where mutation belongs to the agent's next turn, not to clicks.
 */
export interface WidgetBodyProps {
  rootId: string;
  data: unknown;
  readonly?: boolean;
  /** Persist a new `data` object. Components do their own optimistic state. */
  onPatch?: (newData: unknown) => void | Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<WidgetKind, ComponentType<any>> = {
  markdown: MarkdownWidget,
  "news-list": NewsListWidget,
  "link-list": LinkListWidget,
  kpi: KpiWidget,
  checklist: ChecklistWidget,
  quote: QuoteWidget,
  "kb-pinned": KbPinnedWidget,
  progress: ProgressWidget,
  image: ImageWidget,
  "stat-table": StatTableWidget,
  map: MapWidget,
  "utility-card": UtilityCardWidget,
};

/**
 * Resolve a widget kind to its renderer. Unknown kinds fall back to a
 * "broken widget" placeholder — better than a crash if the agent invents
 * a new kind we haven't shipped yet.
 */
export function renderWidget(
  rootId: string,
  kind: string,
  data: unknown,
  opts?: {
    readonly?: boolean;
    onPatch?: (newData: unknown) => void | Promise<void>;
    /** Widget record id — needed by utility-card for live refresh. */
    widgetId?: string;
  },
): React.ReactElement {
  const Component = REGISTRY[kind as WidgetKind];
  if (!Component) {
    return <UnknownKind kind={kind} />;
  }
  return (
    <Component
      rootId={rootId}
      data={data}
      readonly={opts?.readonly ?? false}
      onPatch={opts?.onPatch}
      widgetId={opts?.widgetId}
    />
  );
}

function UnknownKind({ kind }: { kind: string }) {
  const t = useTranslations("roots");
  return (
    <p className="text-xs text-destructive">
      {t.rich("widgetsCommon.unknownKind", {
        kind,
        code: (chunks) => <code className="font-mono">{chunks}</code>,
      })}
    </p>
  );
}

export function isKnownKind(kind: string): kind is WidgetKind {
  return kind in REGISTRY;
}
