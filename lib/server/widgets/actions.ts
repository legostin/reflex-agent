"use server";

import { revalidatePath } from "next/cache";
import { getRoot } from "@/lib/registry";
import {
  deleteWidget,
  listWidgets,
  readLayout,
  readWidget,
  reconcileLayout,
  writeLayout,
  writeWidget,
} from "./store";
import {
  SYSTEM_WIDGET_IDS,
  type WidgetRefresh,
  type WidgetSizeMode,
} from "./types";
import { agentManager } from "../agents/manager";
import { startOrchestratorTurn } from "../agents/start-turn";

/**
 * Client-callable helpers for the dashboard widget grid. Keep these
 * idempotent — drag-and-drop fires saveLayout on every drop, hide and
 * restore fire on every click. Each call returns the reconciled layout
 * so the UI doesn't have to re-fetch.
 */

export type LayoutResult =
  | {
      ok: true;
      layout: {
        order: string[];
        hidden: string[];
        sizes?: Record<string, WidgetSizeMode>;
      };
    }
  | { ok: false; error: string };

type LayoutShape = {
  order: string[];
  hidden: string[];
  sizes?: Record<string, WidgetSizeMode>;
};

async function withReconciled(
  rootPath: string,
  mutator: (l: LayoutShape) => LayoutShape,
): Promise<LayoutResult> {
  const records = await listWidgets(rootPath);
  const layout = await readLayout(rootPath);
  const next = mutator(layout);
  const reconciled = reconcileLayout(
    next,
    records.map((r) => r.id),
    SYSTEM_WIDGET_IDS,
  );
  await writeLayout(rootPath, reconciled);
  return { ok: true, layout: reconciled };
}

export async function saveWidgetOrderAction(
  rootId: string,
  order: string[],
): Promise<LayoutResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const result = await withReconciled(entry.path, (cur) => ({
      ...cur,
      order: order.filter((id) => !cur.hidden.includes(id)),
    }));
    revalidatePath(`/roots/${rootId}`);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function hideWidgetAction(
  rootId: string,
  widgetId: string,
): Promise<LayoutResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const result = await withReconciled(entry.path, (cur) => ({
      order: cur.order.filter((id) => id !== widgetId),
      hidden: [...new Set([widgetId, ...cur.hidden])],
    }));
    revalidatePath(`/roots/${rootId}`);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function restoreWidgetAction(
  rootId: string,
  widgetId: string,
): Promise<LayoutResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const result = await withReconciled(entry.path, (cur) => ({
      order: [widgetId, ...cur.order.filter((id) => id !== widgetId)],
      hidden: cur.hidden.filter((id) => id !== widgetId),
    }));
    revalidatePath(`/roots/${rootId}`);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Direct user-initiated mutation of a widget's `data` (and optionally
 * `memory`). Skips the agent entirely — interactive affordances like
 * "tick a checklist item", "unpin a KB file", "increment a counter"
 * route here, write straight to disk, bump `updatedAt`. The agent picks
 * up the new state on the next `widget-update` (its memory still reads
 * authoritatively from disk).
 *
 * `newData` MUST match the widget's existing `kind` — we don't allow
 * morphing a checklist into a news-list via this path. For that, the
 * agent flow with `widget-update` is the right tool.
 */
export async function patchWidgetDataAction(
  rootId: string,
  widgetId: string,
  newData: unknown,
  newMemory?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const w = await readWidget(entry.path, widgetId);
    if (!w) return { ok: false, error: "Widget not found" };
    if (!newData || typeof newData !== "object") {
      return { ok: false, error: "newData must be an object" };
    }
    const next = {
      ...w,
      data: newData,
      updatedAt: new Date().toISOString(),
      ...(newMemory !== undefined ? { memory: newMemory } : {}),
    } as typeof w;
    await writeWidget(entry.path, next);
    revalidatePath(`/roots/${rootId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Persist a user-chosen size for the widget. The layout file is the
 * single source of truth — overrides whatever the widget record itself
 * declares (so the user's resize survives the agent's next widget-update).
 * Works for both user widgets and system slots (`sys:*` ids).
 */
export async function setWidgetSizeAction(
  rootId: string,
  widgetId: string,
  mode: WidgetSizeMode,
): Promise<LayoutResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const result = await withReconciled(entry.path, (cur) => ({
      ...cur,
      sizes: { ...(cur.sizes ?? {}), [widgetId]: mode },
    }));
    revalidatePath(`/roots/${rootId}`);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Update a widget's auto-refresh cadence. "manual" disables the
 * scheduler entry for this widget; anything else queues it for the next
 * tick (which fires within ~5 min).
 */
export async function setWidgetRefreshAction(
  rootId: string,
  widgetId: string,
  refresh: WidgetRefresh,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const w = await readWidget(entry.path, widgetId);
    if (!w) return { ok: false, error: "Widget not found" };
    const next = { ...w, refresh } as typeof w;
    await writeWidget(entry.path, next);
    revalidatePath(`/roots/${rootId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Trigger a one-off refresh of a widget right now — same prompt the
 * scheduler uses, just on-demand. Returns immediately with the agent id
 * if the turn started successfully; UI subscribes to the topic stream to
 * see the widget-update event.
 */
export async function refreshWidgetNowAction(
  rootId: string,
  widgetId: string,
): Promise<{ ok: boolean; error?: string; agentId?: string }> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const w = await readWidget(entry.path, widgetId);
    if (!w) return { ok: false, error: "Widget not found" };
    if (!w.sourceTopicId) {
      return {
        ok: false,
        error:
          "Widget has no source topic — update it from any chat first.",
      };
    }
    if (agentManager.isActive(w.sourceTopicId)) {
      return {
        ok: false,
        error:
          "The source topic is already occupied by an agent — wait for the current turn to finish.",
      };
    }
    // Stamp BEFORE firing — scheduler invariant.
    const stamped = { ...w, lastRefreshAt: new Date().toISOString() };
    await writeWidget(entry.path, stamped);
    // Reuse the scheduler's prompt-builder so behaviour is identical.
    const { buildRefreshPromptForWidget } = await import("./scheduler-bridge");
    const message = await buildRefreshPromptForWidget(entry.path, stamped);
    const res = await startOrchestratorTurn({
      rootId,
      topicId: w.sourceTopicId,
      message,
      attachments: [],
    });
    if ("error" in res) return { ok: false, error: res.error };
    return { ok: true, agentId: res.agentId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Permanently delete a user widget from disk. Library entries for it
 * disappear — there's no restore. System widgets cannot be deleted (only
 * hidden via `hideWidgetAction`).
 */
export async function deleteWidgetAction(
  rootId: string,
  widgetId: string,
): Promise<LayoutResult> {
  try {
    if ((SYSTEM_WIDGET_IDS as readonly string[]).includes(widgetId)) {
      return {
        ok: false,
        error: "System widget cannot be deleted — only hidden.",
      };
    }
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    await deleteWidget(entry.path, widgetId);
    const result = await withReconciled(entry.path, (cur) => ({
      order: cur.order.filter((id) => id !== widgetId),
      hidden: cur.hidden.filter((id) => id !== widgetId),
    }));
    revalidatePath(`/roots/${rootId}`);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
