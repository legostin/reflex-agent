"use server";

import { runHeadlessAgent } from "./headless";
import { getUtility } from "@/lib/server/utilities/store";
import type { UtilityScope } from "@/lib/server/utilities/types";

/**
 * Server-action wrapper around `runHeadlessAgent` for the in-utility
 * chat sidebar. We pre-pend a small context block describing the
 * utility (id, name, manifest description) so the agent answers with
 * scope awareness — and optionally fold in a snapshot the utility
 * iframe pushed via postMessage. Returns the agent's text reply.
 */
export interface UtilityChatArgs {
  rootId: string;
  utilityId: string;
  scope: UtilityScope;
  prompt: string;
  /** Optional structured snapshot the iframe described. */
  snapshot?: unknown;
}

export interface UtilityChatResult {
  ok: boolean;
  text?: string;
  error?: string;
  timedOut?: boolean;
}

const MAX_SNAPSHOT_CHARS = 8_000;

export async function runUtilityChatAction(
  args: UtilityChatArgs,
): Promise<UtilityChatResult> {
  try {
    const util = await getUtility(
      args.scope,
      args.utilityId,
      args.scope === "project" ? args.rootId : undefined,
    );
    if (!util) {
      return { ok: false, error: "Utility not found." };
    }
    const snapshotBlock =
      args.snapshot !== undefined
        ? formatSnapshot(args.snapshot)
        : "";
    const prompt = [
      `You are helping the user inside the mini-app "${util.manifest.name}" (id=${util.manifest.id}).`,
      util.manifest.description
        ? `Description: ${util.manifest.description}`
        : "",
      snapshotBlock
        ? `\n## Current mini-app state\n${snapshotBlock}`
        : "",
      "",
      `## User question\n${args.prompt}`,
      "",
      "Answer briefly and to the point. If you need data not in the snapshot, say so and suggest how to obtain it.",
    ]
      .filter(Boolean)
      .join("\n");
    const res = await runHeadlessAgent({
      rootId: args.rootId,
      prompt,
      label: `[utility-chat ${util.manifest.id}]`,
    });
    return { ok: true, text: res.text, timedOut: res.timedOut };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatSnapshot(snapshot: unknown): string {
  let text: string;
  try {
    text = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot, null, 2);
  } catch {
    text = String(snapshot);
  }
  if (text.length > MAX_SNAPSHOT_CHARS) {
    text = text.slice(0, MAX_SNAPSHOT_CHARS) + "\n…[truncated]";
  }
  return "```\n" + text + "\n```";
}
