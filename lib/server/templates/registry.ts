import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { addRoot } from "@/lib/registry";
import { reflexHome } from "@/lib/reflex/home";
import { createTopic } from "@/lib/server/topics";
import {
  buildRecord,
  readLayout,
  reconcileLayout,
  writeLayout,
  writeWidget,
} from "@/lib/server/widgets/store";
import { SYSTEM_WIDGET_IDS, type WidgetData } from "@/lib/server/widgets/types";
import type { Settings } from "@/lib/settings";

/**
 * Library of "Space templates" — pre-baked combinations of widgets,
 * seed topics, and a role skill, designed so a non-technical user can
 * pick a life area during onboarding and have something useful on day 1.
 *
 * Each template is self-contained — running its `seed()` is idempotent
 * (writes are over-writes) and isolated to the target rootPath. The
 * onboarding wizard picks a base dir (default `~/Reflex/<id>`) and calls
 * `materializeSpace()` which: mkdir, addRoot, run seed.
 */

export interface SeedContext {
  rootPath: string;
  settings: Settings;
}

export interface SeedWidget {
  id: string;
  title: string;
  description?: string;
  payload: WidgetData;
  /** When true, the widget is placed on the dashboard (default behaviour).
   *  Templates rarely need to hide widgets — leave undefined. */
  hidden?: boolean;
}

export interface SeedTopic {
  /** First user-message that opens the conversation. */
  message: string;
  /** Optional goal text to attach to the topic frontmatter. */
  goal?: string;
}

export interface SeedSkill {
  id: string;
  title: string;
  description: string;
  /** Markdown body — written verbatim under frontmatter. */
  instructions: string;
}

export interface SpaceTemplate {
  id: string;
  label: string;
  emoji: string;
  /** One-line user-facing description shown on the template card. */
  description: string;
  /** Default subfolder name under the user's base directory. */
  defaultFolder: string;
  /** Build the seed payload — pure function, no I/O. */
  build: (ctx: SeedContext) => {
    widgets: SeedWidget[];
    topics?: SeedTopic[];
    skills?: SeedSkill[];
  };
}

/**
 * Atomic apply: idempotent. Writes every widget file, updates the layout
 * so they appear in `order` in the listed sequence, creates seed topics,
 * and installs skills (if not already present under `~/.reflex/skills/`).
 */
export async function applyTemplate(
  template: SpaceTemplate,
  ctx: SeedContext,
): Promise<{ widgetsCreated: number; topicsCreated: number; skillsInstalled: number }> {
  const payload = template.build(ctx);
  // Widgets first — write records, then merge into layout in stable order.
  for (const w of payload.widgets) {
    const record = buildRecord({
      id: w.id,
      title: w.title,
      ...(w.description ? { description: w.description } : {}),
      payload: w.payload,
    });
    await writeWidget(ctx.rootPath, record);
  }
  const layout = await readLayout(ctx.rootPath);
  const visibleSeed = payload.widgets
    .filter((w) => !w.hidden)
    .map((w) => w.id);
  const hiddenSeed = payload.widgets.filter((w) => w.hidden).map((w) => w.id);
  // Keep the four system slots at the top, then template widgets in their
  // declared order. Existing user widgets (in case of re-apply) survive.
  const nextOrder = [
    ...layout.order.filter((id) => SYSTEM_WIDGET_IDS.includes(id as never)),
    ...visibleSeed,
    ...layout.order.filter(
      (id) =>
        !SYSTEM_WIDGET_IDS.includes(id as never) && !visibleSeed.includes(id),
    ),
  ];
  const nextHidden = [
    ...layout.hidden.filter((id) => !hiddenSeed.includes(id)),
    ...hiddenSeed,
  ];
  const reconciled = reconcileLayout(
    { ...layout, order: nextOrder, hidden: nextHidden },
    payload.widgets.map((w) => w.id),
    SYSTEM_WIDGET_IDS,
  );
  await writeLayout(ctx.rootPath, reconciled);

  let topicsCreated = 0;
  for (const t of payload.topics ?? []) {
    await createTopic({
      root: ctx.rootPath,
      firstMessage: t.message,
      ...(ctx.settings.language ? { language: ctx.settings.language } : {}),
    });
    topicsCreated++;
  }

  let skillsInstalled = 0;
  for (const sk of payload.skills ?? []) {
    if (await installSkill(sk)) skillsInstalled++;
  }

  return {
    widgetsCreated: payload.widgets.length,
    topicsCreated,
    skillsInstalled,
  };
}

/**
 * Default base directory for template-spawned Spaces. Lives outside the
 * Reflex repo so user data is portable.
 */
export function defaultBaseDir(): string {
  return path.join(os.homedir(), "Reflex");
}

/**
 * Resolve the target path for a template, create the directory if it
 * doesn't exist, register it as a root, and return the entry. Idempotent.
 */
export async function materializeSpace(args: {
  template: SpaceTemplate;
  baseDir?: string;
}): Promise<{ rootPath: string; rootId: string }> {
  const base = args.baseDir ?? defaultBaseDir();
  const target = path.join(base, args.template.defaultFolder);
  await fs.mkdir(target, { recursive: true });
  const entry = await addRoot(target);
  return { rootPath: entry.path, rootId: entry.id };
}

async function installSkill(s: SeedSkill): Promise<boolean> {
  const dir = path.join(reflexHome(), "skills");
  const file = path.join(dir, `${s.id}.md`);
  try {
    await fs.access(file);
    return false; // already exists — don't clobber user edits
  } catch {
    /* not found, write it */
  }
  await fs.mkdir(dir, { recursive: true });
  const body = `---\nid: ${s.id}\ntitle: ${s.title}\ndescription: ${s.description.replace(/\n/g, " ")}\n---\n\n${s.instructions.trim()}\n`;
  await fs.writeFile(file, body, "utf8");
  return true;
}

// Per-template registrations — kept lazy so a missing file doesn't break
// the whole registry; templates can ship independently.
import { financeTemplate } from "./finance";
import { healthTemplate } from "./health";
import { studyTemplate } from "./study";
import { travelTemplate } from "./travel";

export const SPACE_TEMPLATES: SpaceTemplate[] = [
  financeTemplate,
  healthTemplate,
  studyTemplate,
  travelTemplate,
];

export function findTemplate(id: string): SpaceTemplate | undefined {
  return SPACE_TEMPLATES.find((t) => t.id === id);
}
