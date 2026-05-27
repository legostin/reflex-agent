"use server";

import { revalidatePath } from "next/cache";
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  updateMcpServer,
  type McpServerEntry,
} from "./mcp-registry";
import {
  McpConfigSchema,
  connectAndListTools,
  type McpToolSpec,
} from "./utilities/mcp";
import { listRoots } from "@/lib/registry";
import { createTopic } from "./topics";
import { loadSettings } from "@/lib/settings/store";
import { startOrchestratorTurn } from "./agents/start-turn";

export type ListMcpServersResult =
  | { ok: true; servers: McpServerEntry[] }
  | { ok: false; error: string };

export async function listMcpServersAction(): Promise<ListMcpServersResult> {
  try {
    const servers = await listMcpServers();
    return { ok: true, servers };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface AddMcpServerArgs {
  id: string;
  label: string;
  description?: string;
  config: unknown;
}

export async function addMcpServerAction(
  args: AddMcpServerArgs,
): Promise<{ ok: true; server: McpServerEntry } | { ok: false; error: string }> {
  try {
    const config = McpConfigSchema.parse(args.config);
    const entry = await addMcpServer({
      id: args.id,
      label: args.label,
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
      config,
    });
    revalidatePath("/settings");
    return { ok: true, server: entry };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateMcpServerAction(args: {
  id: string;
  label?: string;
  description?: string;
  config?: unknown;
}): Promise<{ ok: true; server: McpServerEntry } | { ok: false; error: string }> {
  try {
    const patch: Parameters<typeof updateMcpServer>[1] = {};
    if (args.label !== undefined) patch.label = args.label;
    if (args.description !== undefined) patch.description = args.description;
    if (args.config !== undefined) patch.config = McpConfigSchema.parse(args.config);
    const entry = await updateMcpServer(args.id, patch);
    revalidatePath("/settings");
    return { ok: true, server: entry };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removeMcpServerAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await removeMcpServer(id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type StartMcpSetupResult =
  | { ok: true; rootId: string; topicId: string }
  | { ok: false; error: string };

/**
 * Wizard entry point: user types something like "Добавь MCP Google Calendar",
 * we spin up a topic in the first registered project root and prime the
 * orchestrator with an MCP-installer brief. The orchestrator then researches
 * the right command/package, optionally asks clarifying questions, and emits
 * `<<reflex:mcp-add>>` — which the user approves inside the chat via the
 * normal McpAddCard. This removes the need for the user to know exact
 * package names, env-var keys, or OAuth steps.
 */
export async function startMcpSetupAction(
  prompt: string,
): Promise<StartMcpSetupResult> {
  try {
    const text = prompt.trim();
    if (!text) return { ok: false, error: "empty prompt" };
    const roots = await listRoots();
    const root = roots[0];
    if (!root) {
      return {
        ok: false,
        error: "no project root registered — add a root first",
      };
    }
    const settings = await loadSettings();
    const assignment = settings.assignments.chat;
    const topic = await createTopic({
      root: root.path,
      firstMessage: `MCP setup: ${text.slice(0, 60)}`,
      harness: assignment.harness,
      model: assignment.model,
      language: settings.language,
    });
    // The visible user message is just the user's request. Detailed
    // instructions live in the chat system prompt's "Регистрация MCP-сервера"
    // section + a compact addendum below — keeps the topic readable.
    const message = [
      `[MCP setup wizard] ${text}`,
      "",
      "Подбери нужный MCP-сервер (популярные npm-пакеты: `@modelcontextprotocol/server-<name>` или сторонние; HTTP-endpoint вендора если есть). Реши какие токены/credentials нужны и где их взять (Google → OAuth Playground, GitHub → PAT, Slack/Notion → internal token). Эмить `<<reflex:mcp-add>>` с полной конфигурацией; всё, что должен ввести пользователь — в `secrets[]` с понятной инструкцией. Если не уверен в выборе пакета — спроси через `<<reflex:question>>`.",
    ].join("\n");
    const result = await startOrchestratorTurn({
      rootId: root.id,
      topicId: topic.meta.id,
      message,
    });
    if ("error" in result) return { ok: false, error: result.error };
    revalidatePath(`/roots/${root.id}`);
    return { ok: true, rootId: root.id, topicId: topic.meta.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type TestMcpServerResult =
  | {
      ok: true;
      serverName?: string;
      serverVersion?: string;
      tools: McpToolSpec[];
    }
  | { ok: false; error: string };

export async function testMcpServerAction(
  rawConfig: unknown,
): Promise<TestMcpServerResult> {
  try {
    const config = McpConfigSchema.parse(rawConfig);
    const info = await connectAndListTools(config);
    return {
      ok: true,
      ...(info.name ? { serverName: info.name } : {}),
      ...(info.version ? { serverVersion: info.version } : {}),
      tools: info.tools,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
