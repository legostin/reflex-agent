import "server-only";

/**
 * Mustache-lite template engine for workflow params. Supports:
 *   {{prev}}                      — output of the immediately prior step
 *   {{steps.<id>.output}}         — full output of any prior step
 *   {{steps.<id>.output.<field>}} — dot-path into a JSON output
 *   {{input.<field>}}             — initial trigger input
 *   {{workflow.label}}            — workflow metadata
 *
 * Values are stringified: strings stay as-is, objects/arrays become JSON.
 * Unknown refs render as empty string (workflow continues, never throws).
 * Keep this intentionally small — domain users compose by clicking; the
 * template language is just escape-hatch glue.
 */

export interface TemplateContext {
  prev?: unknown;
  steps: Record<string, { output: unknown }>;
  input?: unknown;
  workflow: { id: string; label: string };
}

const REF = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export function renderString(template: string, ctx: TemplateContext): string {
  return template.replace(REF, (_match, path: string) => {
    const value = resolve(path.trim(), ctx);
    return stringify(value);
  });
}

/**
 * Deep-render every string leaf in a params object. Numbers, booleans,
 * nested objects/arrays are walked. JSON-typed fields (where the user
 * pasted JSON in the param UI) become objects via JSON.parse after
 * rendering — that's done at handler-level, not here.
 */
export function renderParams(
  params: Record<string, unknown>,
  ctx: TemplateContext,
): Record<string, unknown> {
  return walk(params, ctx) as Record<string, unknown>;
}

function walk(v: unknown, ctx: TemplateContext): unknown {
  if (typeof v === "string") return renderString(v, ctx);
  if (Array.isArray(v)) return v.map((x) => walk(x, ctx));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val, ctx);
    return out;
  }
  return v;
}

function resolve(path: string, ctx: TemplateContext): unknown {
  if (path === "prev") return ctx.prev;
  if (path.startsWith("workflow.")) {
    const key = path.slice("workflow.".length);
    return (ctx.workflow as unknown as Record<string, unknown>)[key];
  }
  if (path.startsWith("input.")) {
    return pluck(ctx.input, path.slice("input.".length));
  }
  if (path.startsWith("input")) {
    return ctx.input;
  }
  if (path.startsWith("steps.")) {
    const rest = path.slice("steps.".length);
    const [id, ...tail] = rest.split(".");
    if (!id) return undefined;
    const step = ctx.steps[id];
    if (!step) return undefined;
    if (tail.length === 0 || (tail.length === 1 && tail[0] === "output")) {
      return step.output;
    }
    if (tail[0] === "output") {
      return pluck(step.output, tail.slice(1).join("."));
    }
    return undefined;
  }
  return undefined;
}

function pluck(obj: unknown, dotPath: string): unknown {
  if (!dotPath) return obj;
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
