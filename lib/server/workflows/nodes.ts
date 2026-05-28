import "server-only";
import { writeKbEntry } from "@/lib/server/agents/kb-writer";
import { runHeadlessAgent } from "@/lib/server/agents/headless";
import type { WorkflowStepKind } from "./types";

/**
 * Handler registry. Each entry takes `params` (already template-rendered)
 * and a `ctx` with root info, and returns the step's `output` — anything
 * JSON-serializable. Subsequent steps reference outputs by step id.
 *
 * Conventions:
 *   - Handlers throw on failure; runner catches and marks the step `failed`.
 *   - `output` should be the "useful" payload (text body for fetch, agent
 *     reply for ask-agent, kb-write result for kb-write) — not the raw
 *     wrapper response.
 */

export interface NodeContext {
  rootId: string;
  rootPath: string;
  /** Workflow id + label — handlers may use these for KB entry titles, etc. */
  workflow: { id: string; label: string };
}

export type NodeHandler = (
  params: Record<string, unknown>,
  ctx: NodeContext,
) => Promise<unknown>;

export const NODE_HANDLERS: Record<WorkflowStepKind, NodeHandler> = {
  "text-template": async (params) => {
    // Template was already rendered by the runner before we got here.
    // Just return the rendered text as-is.
    return typeof params.template === "string" ? params.template : "";
  },

  "http-request": async (params) => {
    const url = mustString(params.url, "url");
    const method = stringOr(params.method, "GET").toUpperCase();
    const headers = parseJsonOr(params.headers, {});
    const bodyRaw = stringOr(params.body, "");
    const init: RequestInit = {
      method,
      headers: headers as Record<string, string>,
    };
    if (method !== "GET" && method !== "HEAD" && bodyRaw) init.body = bodyRaw;
    const res = await fetch(url, init);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return parsed;
  },

  "web-fetch": async (params) => {
    const url = mustString(params.url, "url");
    const res = await fetch(url, {
      headers: { "User-Agent": "Reflex-Workflow/1.0" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  },

  "ask-agent": async (params, ctx) => {
    const prompt = mustString(params.prompt, "prompt");
    const { text } = await runHeadlessAgent({
      rootId: ctx.rootId,
      prompt,
      label: `[workflow ${ctx.workflow.id}] ${ctx.workflow.label}`,
    });
    return text;
  },

  "kb-write": async (params, ctx) => {
    const kind = stringOr(params.kind, "note");
    const title = stringOr(
      params.title,
      `Workflow ${ctx.workflow.label}`,
    );
    const body = stringOr(params.body, "");
    const result = await writeKbEntry({
      rootPath: ctx.rootPath,
      directive: { kind, title, body },
    });
    return {
      kind: result.kind,
      title: result.title,
      relPath: result.relPath,
      absPath: result.absPath,
    };
  },

  "image-generate": async (params, ctx) => {
    const prompt = mustString(params.prompt, "prompt");
    const provider =
      params.provider === "codex" || params.provider === "gemini"
        ? (params.provider as "gemini" | "codex")
        : undefined;
    const { generateImage } = await import("@/lib/server/images/service");
    const result = await generateImage({
      rootId: ctx.rootId,
      prompt,
      ...(provider ? { provider } : {}),
      ...(typeof params.size === "string" && params.size
        ? { size: params.size }
        : {}),
      ...(typeof params.aspectRatio === "string" && params.aspectRatio
        ? { aspectRatio: params.aspectRatio }
        : {}),
    });
    return {
      url: result.urlPath,
      sha: result.sha,
      size: result.size,
      mime: result.mime,
      provider: result.provider,
    };
  },

  "image-search": async (params) => {
    const query = mustString(params.query, "query");
    const provider =
      params.provider === "pexels" ||
      params.provider === "unsplash" ||
      params.provider === "brave"
        ? (params.provider as "unsplash" | "pexels" | "brave")
        : undefined;
    let count: number | undefined;
    if (typeof params.count === "number") count = params.count;
    else if (typeof params.count === "string" && params.count.trim()) {
      const n = parseInt(params.count, 10);
      if (Number.isFinite(n) && n > 0) count = n;
    }
    const { searchImages } = await import("@/lib/server/images/service");
    const results = await searchImages({
      query,
      ...(provider ? { provider } : {}),
      ...(count !== undefined ? { count } : {}),
    });
    return { results };
  },

  "utility-call": async (params, ctx) => {
    const utilityId = mustString(params.utilityId, "utilityId");
    const actionName = mustString(params.actionName, "actionName");
    const utilityScope =
      params.utilityScope === "project" ? "project" : "global";
    // `args` may arrive as a JSON string (from the editor) or as an
    // already-parsed object (programmatic invocations). Both are accepted.
    let actionArgs: unknown = params.args ?? {};
    if (typeof actionArgs === "string") {
      try {
        actionArgs = actionArgs.trim() ? JSON.parse(actionArgs) : {};
      } catch (err) {
        throw new Error(
          `utility-call: args is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const { getUtility } = await import("@/lib/server/utilities/store");
    const utility = await getUtility(
      utilityScope,
      utilityId,
      utilityScope === "project" ? ctx.rootId : undefined,
    );
    if (!utility) {
      throw new Error(
        `utility-call: ${utilityScope}/${utilityId} not installed`,
      );
    }
    const action = utility.manifest.serverActions.find(
      (a) => a.name === actionName,
    );
    if (!action) {
      throw new Error(
        `utility-call: ${utilityId} has no serverAction "${actionName}"`,
      );
    }
    const { runServerAction } = await import(
      "@/lib/server/utilities/worker-pool"
    );
    return runServerAction({
      utility,
      action,
      args: actionArgs,
      // Link the worker's audit trail to the originating workflow run.
      parentCorrelationId: `workflow:${ctx.workflow.id}`,
    });
  },

  notify: async (params) => {
    // Deliver to the user's configured channels (Telegram, …). Body
    // defaults to the previous step's output so "summarise X → notify"
    // needs no glue step.
    const body = stringOr(params.body, stringOr(params.text, "")).trim();
    if (!body) throw new Error("notify: body is empty");
    const { notify } = await import("@/lib/server/notify");
    const res = await notify({
      body,
      ...(typeof params.title === "string" && params.title
        ? { title: params.title }
        : {}),
      ...(typeof params.link === "string" && params.link
        ? { link: params.link }
        : {}),
    });
    return { delivered: res.delivered, errors: res.errors };
  },
};

function mustString(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Param "${field}" is required (string)`);
  }
  return v;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function parseJsonOr<T>(v: unknown, fallback: T): T | unknown {
  if (typeof v !== "string" || !v.trim()) return fallback;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return fallback;
  }
}

