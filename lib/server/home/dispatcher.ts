import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HOME_ROOT_ID, homeRootEntry } from "@/lib/registry";
import { createTopic, getTopic } from "@/lib/server/topics";
import { loadSettings } from "@/lib/settings/store";

/**
 * The dispatcher — a single, never-ending chat that lives in the
 * synthetic "home" Space. It's the central thread the user talks to from
 * the web home page AND from Telegram; both surfaces open this same
 * topic, so the conversation is continuous across devices.
 *
 * Its id is pinned in `<home>/dispatcher.json` so every entry point
 * resolves the same topic. Created lazily on first use.
 */

interface DispatcherState {
  topicId?: string;
}

function statePath(): string {
  return path.join(homeRootEntry().path, "dispatcher.json");
}

async function readState(): Promise<DispatcherState> {
  try {
    return JSON.parse(await fs.readFile(statePath(), "utf8")) as DispatcherState;
  } catch {
    return {};
  }
}

async function writeState(state: DispatcherState): Promise<void> {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}

export interface DispatcherHandle {
  rootId: string;
  rootPath: string;
  topicId: string;
}

/** Resolve (or lazily create) the one dispatcher topic. */
export async function getDispatcherTopic(): Promise<DispatcherHandle> {
  const home = homeRootEntry();
  const state = await readState();
  if (state.topicId) {
    const existing = await getTopic(home.path, state.topicId).catch(() => null);
    if (existing) {
      return { rootId: HOME_ROOT_ID, rootPath: home.path, topicId: state.topicId };
    }
  }
  const settings = await loadSettings();
  const a = settings.assignments.chat;
  const topic = await createTopic({
    root: home.path,
    firstMessage: "Dispatcher",
    harness: a.harness,
    model: a.model,
    language: settings.language,
  });
  await writeState({ ...state, topicId: topic.meta.id });
  return { rootId: HOME_ROOT_ID, rootPath: home.path, topicId: topic.meta.id };
}
