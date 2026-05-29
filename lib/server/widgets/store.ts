import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexRoot } from "@/lib/reflex/paths";
import { sanitizeIdDash } from "@/lib/reflex/ids";
import { writeJsonFile } from "@/lib/reflex/store/json-store";
import type {
  DashboardLayout,
  WidgetData,
  WidgetKind,
  WidgetRecord,
} from "./types";
import { WIDGET_KINDS } from "./types";

/**
 * Disk layout:
 *   <root>/.reflex/widgets/<id>.json    — one file per widget record
 *   <root>/.reflex/dashboard-layout.json — order + hidden lists
 *
 * Storing layout separately from widget records means a single drag-and-drop
 * gesture writes a tiny JSON, no churn on the widget bodies themselves.
 */

const WIDGETS_DIR = "widgets";
const LAYOUT_FILE = "dashboard-layout.json";

function widgetsDir(rootPath: string): string {
  return path.join(reflexRoot(rootPath), WIDGETS_DIR);
}

function widgetFile(rootPath: string, id: string): string {
  return path.join(widgetsDir(rootPath), `${sanitizeId(id)}.json`);
}

function layoutFile(rootPath: string): string {
  return path.join(reflexRoot(rootPath), LAYOUT_FILE);
}

export function sanitizeId(id: string): string {
  return sanitizeIdDash(id);
}

export async function listWidgets(rootPath: string): Promise<WidgetRecord[]> {
  const dir = widgetsDir(rootPath);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: WidgetRecord[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, e.name), "utf8");
      const parsed = JSON.parse(raw) as WidgetRecord;
      if (validateRecord(parsed)) out.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export async function readWidget(
  rootPath: string,
  id: string,
): Promise<WidgetRecord | null> {
  try {
    const raw = await fs.readFile(widgetFile(rootPath, id), "utf8");
    const parsed = JSON.parse(raw) as WidgetRecord;
    return validateRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeWidget(
  rootPath: string,
  record: WidgetRecord,
): Promise<void> {
  if (!validateRecord(record as unknown)) {
    throw new Error(
      `Invalid widget record (id=${record.id}, kind=${record.kind})`,
    );
  }
  await writeJsonFile(widgetFile(rootPath, record.id), record);
}

/**
 * Read the contents of a widget's external memory file (if `memoryFile`
 * is set). Path-safe — refuses anything outside the project's .reflex/.
 * Returns null on missing file or invalid path.
 */
export async function readWidgetMemoryFile(
  rootPath: string,
  memoryFile: string,
): Promise<string | null> {
  try {
    const scope = reflexRoot(rootPath);
    const abs = path.resolve(scope, memoryFile);
    const rel = path.relative(scope, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function deleteWidget(
  rootPath: string,
  id: string,
): Promise<boolean> {
  try {
    await fs.unlink(widgetFile(rootPath, id));
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_LAYOUT: DashboardLayout = {
  order: [
    "sys:active-goals",
    "sys:pending",
    "sys:recent-kb",
    "sys:ai-suggestions",
  ],
  hidden: [],
  sizes: {},
};

const VALID_MODES = new Set(["sm", "md", "wide"]);

export async function readLayout(rootPath: string): Promise<DashboardLayout> {
  try {
    const raw = await fs.readFile(layoutFile(rootPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) {
      return DEFAULT_LAYOUT;
    }
    const sizes: Record<string, "sm" | "md" | "wide"> = {};
    if (parsed.sizes && typeof parsed.sizes === "object") {
      for (const [k, v] of Object.entries(parsed.sizes)) {
        if (typeof v === "string" && VALID_MODES.has(v)) {
          sizes[k] = v as "sm" | "md" | "wide";
        }
      }
    }
    return {
      order: parsed.order.filter((s): s is string => typeof s === "string"),
      hidden: parsed.hidden.filter((s): s is string => typeof s === "string"),
      sizes,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export async function writeLayout(
  rootPath: string,
  layout: DashboardLayout,
): Promise<void> {
  await writeJsonFile(layoutFile(rootPath), layout);
}

/**
 * Reconcile a layout against the current set of widget records.
 *   1. Every existing record id appears either in `order` (visible) or
 *      `hidden`. New widgets get appended to `order` at the end.
 *   2. System widget ids (`sys:*`) are guaranteed to appear in either list
 *      so they can never silently disappear.
 *   3. Stale ids (widget deleted from disk) are pruned.
 */
export function reconcileLayout(
  layout: DashboardLayout,
  recordIds: string[],
  systemIds: readonly string[],
): DashboardLayout {
  const known = new Set<string>([...recordIds, ...systemIds]);
  const order = layout.order.filter((id) => known.has(id));
  const hidden = layout.hidden.filter((id) => known.has(id));
  const placed = new Set([...order, ...hidden]);
  for (const id of [...systemIds, ...recordIds]) {
    if (!placed.has(id)) order.push(id);
  }
  // Drop size entries that point at widgets no longer present.
  const sizes: Record<string, "sm" | "md" | "wide"> = {};
  if (layout.sizes) {
    for (const [k, v] of Object.entries(layout.sizes)) {
      if (known.has(k)) sizes[k] = v;
    }
  }
  return { order, hidden, sizes };
}

function validateRecord(r: unknown): r is WidgetRecord {
  if (!r || typeof r !== "object") return false;
  const rec = r as Record<string, unknown>;
  if (typeof rec.id !== "string" || !rec.id) return false;
  if (typeof rec.title !== "string") return false;
  if (typeof rec.kind !== "string") return false;
  if (!(WIDGET_KINDS as readonly string[]).includes(rec.kind)) return false;
  if (!rec.data || typeof rec.data !== "object") return false;
  if (typeof rec.createdAt !== "string") return false;
  if (typeof rec.updatedAt !== "string") return false;
  return true;
}

/**
 * Build a record from an agent-supplied directive payload. Validates the
 * kind+data combo and stamps timestamps. Inherits refresh/memory fields
 * from `existing` if the directive doesn't override them — agents
 * therefore don't need to re-state the refresh cadence on every update.
 */
export function buildRecord(args: {
  id: string;
  title: string;
  description?: string;
  sourceTopicId?: string;
  payload: WidgetData;
  existing?: WidgetRecord | null;
  size?: import("./types").WidgetSize;
  refresh?: import("./types").WidgetRefresh;
  memory?: string;
  memoryFile?: string;
  /** Set by the scheduler when an auto-refresh turn finishes. */
  lastRefreshAt?: string;
}): WidgetRecord {
  const now = new Date().toISOString();
  const id = sanitizeId(args.id);
  if (!id) throw new Error("Widget id is empty after sanitization");
  if (!(WIDGET_KINDS as readonly WidgetKind[]).includes(args.payload.kind)) {
    throw new Error(`Unknown widget kind: ${args.payload.kind}`);
  }
  const refresh = args.refresh ?? args.existing?.refresh;
  const memory = args.memory ?? args.existing?.memory;
  const memoryFile = args.memoryFile ?? args.existing?.memoryFile;
  const lastRefreshAt = args.lastRefreshAt ?? args.existing?.lastRefreshAt;
  return {
    id,
    title: args.title || id,
    ...(args.description ? { description: args.description } : {}),
    ...(args.sourceTopicId ? { sourceTopicId: args.sourceTopicId } : {}),
    kind: args.payload.kind,
    data: args.payload.data,
    createdAt: args.existing?.createdAt ?? now,
    updatedAt: now,
    ...(args.size
      ? { size: args.size }
      : args.existing?.size
        ? { size: args.existing.size }
        : {}),
    ...(refresh ? { refresh } : {}),
    ...(memory !== undefined ? { memory } : {}),
    ...(memoryFile ? { memoryFile } : {}),
    ...(lastRefreshAt ? { lastRefreshAt } : {}),
  } as WidgetRecord;
}
