import "server-only";
import { z } from "zod";
import { getRoot } from "@/lib/registry";
import { getUtility } from "@/lib/server/utilities/store";
import { runServerAction } from "@/lib/server/utilities/worker-pool";
import { readWidget, writeWidget } from "./store";
import type { UtilityCardData, WidgetRecord } from "./types";

/**
 * Live refresh for a `utility-card` widget.
 *
 * The static-snapshot model (manifest.card.data, only updated when the
 * utility's own iframe calls reflex.cards.update) leaves dashboard cards
 * stale the moment you're not looking at the utility. This pulls fresh
 * data instead: if the utility's `manifest.card.action` is set, we run
 * that server action in a worker (with the utility's host API) and treat
 * its return value as the new inner snapshot.
 *
 * Contract for the action's return value:
 *   { kind, data, title?, description? }   // a card snapshot
 * or
 *   { snapshot: { kind, data, title?, description? } }  // wrapped form
 *
 * If the action returns nothing useful we assume it self-updated via
 * reflex.cards.update and just re-read the widget.
 */

const SnapshotSchema = z.object({
  kind: z.enum([
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
  ]),
  title: z.string().optional(),
  description: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export interface RefreshCardResult {
  ok: boolean;
  /** Fresh inner payload, when a refresh actually happened. */
  inner?: UtilityCardData["inner"];
  /** True when there was nothing to do (no action declared). */
  noop?: boolean;
  error?: string;
}

export async function refreshUtilityCard(
  rootId: string,
  widgetId: string,
): Promise<RefreshCardResult> {
  try {
    const root = await getRoot(rootId);
    if (!root) return { ok: false, error: "Root not found" };
    const widget = await readWidget(root.path, widgetId);
    if (!widget || widget.kind !== "utility-card") {
      return { ok: false, error: "Not a utility-card widget" };
    }
    const data = widget.data as UtilityCardData;
    const util = await getUtility(
      data.utilityScope,
      data.utilityId,
      data.utilityScope === "project" ? rootId : undefined,
    );
    if (!util) return { ok: false, error: "Utility not installed" };

    const cardSpec = util.manifest.card;
    const actionName = cardSpec?.action;
    if (!actionName) {
      // No live action — the card is push-only. Nothing to refresh.
      return { ok: true, noop: true };
    }
    if (!util.manifest.permissions.workers?.enabled) {
      return {
        ok: false,
        error: `${data.utilityId}: card.action needs permissions.workers.enabled`,
      };
    }
    const action = util.manifest.serverActions.find((a) => a.name === actionName);
    if (!action) {
      return { ok: false, error: `card.action "${actionName}" not in serverActions` };
    }

    const raw = await runServerAction({ utility: util, action, args: {} });
    const parsed = parseSnapshot(raw);
    if (!parsed) {
      // Action ran but returned no snapshot — assume it pushed via
      // reflex.cards.update itself; re-read to reflect that.
      const after = await readWidget(root.path, widgetId);
      const inner = (after?.data as UtilityCardData | undefined)?.inner;
      return inner ? { ok: true, inner } : { ok: true, noop: true };
    }

    const inner: UtilityCardData["inner"] = {
      kind: parsed.kind,
      data: parsed.data,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.description ? { description: parsed.description } : {}),
    };
    const next: WidgetRecord = {
      ...widget,
      data: { ...data, inner },
      updatedAt: new Date().toISOString(),
      lastRefreshAt: new Date().toISOString(),
    } as WidgetRecord;
    await writeWidget(root.path, next);
    return { ok: true, inner };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseSnapshot(raw: unknown): z.infer<typeof SnapshotSchema> | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate =
    "snapshot" in (raw as Record<string, unknown>)
      ? (raw as { snapshot: unknown }).snapshot
      : raw;
  const res = SnapshotSchema.safeParse(candidate);
  return res.success ? res.data : null;
}
