"use server";

import { getRoot } from "@/lib/registry";
import { readEvents } from "./events-log";
import { agentManager } from "./manager";
import type { AgentEvent, AgentMeta } from "./types";

export type LoadTopicEventsResult =
  | { ok: true; events: AgentEvent[]; active: boolean }
  | { ok: false; error: string };

export async function loadTopicEventsAction(
  rootId: string,
  topicId: string,
): Promise<LoadTopicEventsResult> {
  try {
    const entry = await getRoot(rootId);
    if (!entry) return { ok: false, error: "Root not found" };
    const events = await readEvents(entry.path, topicId);
    return {
      ok: true,
      events,
      active: agentManager.isActive(topicId),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ListAgentsResult =
  | { ok: true; agents: AgentMeta[] }
  | { ok: false; error: string };

export async function listAgentsAction(args?: {
  topicId?: string;
  rootId?: string;
}): Promise<ListAgentsResult> {
  try {
    return { ok: true, agents: agentManager.list(args) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type GetAgentResult =
  | { ok: true; agent: AgentMeta }
  | { ok: false; error: string };

export async function getAgentAction(
  agentId: string,
): Promise<GetAgentResult> {
  try {
    const agent = agentManager.get(agentId);
    if (!agent) return { ok: false, error: "Agent not found" };
    return { ok: true, agent };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
