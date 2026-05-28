import "server-only";
import { z } from "zod";
import type { WorkflowStepKind } from "./types";

/**
 * Per-kind Zod schemas for `step.params` AFTER template rendering. The
 * runner parses with the matching schema right before calling the
 * handler — converts strings to numbers/booleans where reasonable,
 * surfaces clear errors when something the editor missed slipped
 * through.
 *
 * Schemas live outside `types.ts` so client bundles don't drag in the
 * server-only zod surface.
 */

const TextTemplateSchema = z.object({
  template: z.string().default(""),
});

const HttpRequestSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .default("GET"),
  headers: z
    .union([z.record(z.string(), z.string()), z.string(), z.undefined()])
    .optional(),
  body: z
    .union([z.string(), z.record(z.string(), z.unknown()), z.undefined()])
    .optional(),
});

const WebFetchSchema = z.object({
  url: z.string().url("url must be a valid URL"),
});

const AskAgentSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
});

const KbWriteSchema = z.object({
  kind: z.string().min(1).default("note"),
  title: z.string().default(""),
  body: z.string().default(""),
});

const UtilityCallSchema = z.object({
  utilityId: z.string().min(1, "utilityId is required"),
  utilityScope: z.enum(["global", "project"]).default("global"),
  actionName: z.string().min(1, "actionName is required"),
  // Args may arrive as a JSON-string from the editor (template-rendered)
  // or as a plain object from programmatic invocations — both are valid.
  args: z.unknown().optional(),
});

const ImageGenerateSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  provider: z.enum(["gemini", "codex"]).optional(),
  size: z.string().optional(),
  aspectRatio: z.string().optional(),
});

const ImageSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  provider: z.enum(["unsplash", "pexels", "brave"]).optional(),
  // Editor stores counts as strings; the handler coerces.
  count: z.union([z.string(), z.number()]).optional(),
});

const NotifySchema = z.object({
  body: z.string().default(""),
  text: z.string().optional(),
  title: z.string().optional(),
  link: z.string().optional(),
});

export const STEP_INPUT_SCHEMAS: Record<WorkflowStepKind, z.ZodTypeAny> = {
  "text-template": TextTemplateSchema,
  "http-request": HttpRequestSchema,
  "web-fetch": WebFetchSchema,
  "ask-agent": AskAgentSchema,
  "kb-write": KbWriteSchema,
  "utility-call": UtilityCallSchema,
  "image-generate": ImageGenerateSchema,
  "image-search": ImageSearchSchema,
  notify: NotifySchema,
};

export function validateStepInput(
  kind: WorkflowStepKind,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const schema = STEP_INPUT_SCHEMAS[kind];
  if (!schema) return params;
  const parsed = schema.parse(params);
  return parsed as Record<string, unknown>;
}
