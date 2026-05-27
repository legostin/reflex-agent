import { z } from "zod";

/**
 * Schema + constants for Reflex settings. Importable from both client and
 * server code — keep this file free of node:* imports.
 */

export const HARNESS_IDS = ["claude-code", "codex", "ollama"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const TASK_IDS = ["analyze", "chat", "rag", "embed", "quick"] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const TASK_LABELS: Record<TaskId, { title: string; help: string }> = {
  analyze: {
    title: "Analyze",
    help: "Builds and refreshes the knowledge base. Agentic — runs through Claude Code or Codex with file-write tools.",
  },
  chat: {
    title: "Chat",
    help: "Interactive chat over a folder's KB. Agentic — uses the same harness as analyze by default.",
  },
  rag: {
    title: "RAG",
    help: "Answer questions over the KB without an agent loop. Single-shot LLM call against indexed content.",
  },
  embed: {
    title: "Embeddings",
    help: "Vectorize MD files for retrieval. Ollama runs embedding models locally (e.g. nomic-embed-text).",
  },
  quick: {
    title: "Quick actions",
    help: "Tiny one-shot calls — generates topic titles, summary snippets, labels. Pick a fast/cheap model.",
  },
};

const HarnessesSchema = z.object({
  "claude-code": z.object({
    enabled: z.boolean().default(true),
  }),
  codex: z.object({
    enabled: z.boolean().default(true),
  }),
  ollama: z.object({
    enabled: z.boolean().default(true),
    baseUrl: z.string().url().default("http://localhost:11434"),
  }),
});

const AssignmentSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: z.string().min(1),
  /** Tools the agent may call without prompting the user. Empty = use the
   *  harness's built-in defaults; explicit list overrides. */
  allowedTools: z.array(z.string()).default([]),
});

export const LANGUAGE_PRESETS = [
  "english",
  "русский",
  "español",
  "deutsch",
  "français",
  "中文",
  "日本語",
] as const;

export const IMAGE_FORMATS = ["auto", "jpeg", "webp", "original"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

const ImageProcessingSchema = z.object({
  /** When false, images are stored byte-for-byte (no resize / no recompress). */
  enabled: z.boolean().default(true),
  /** Longest edge in pixels; bigger images shrink while preserving aspect. */
  maxDimension: z.number().int().min(256).max(8192).default(2000),
  /** Encoder quality for lossy formats (jpeg/webp). */
  quality: z.number().int().min(40).max(100).default(85),
  /**
   * Output container:
   *   auto     — JPEG, unless the image has alpha (then keep as PNG)
   *   jpeg     — force JPEG (alpha flattened over white)
   *   webp     — force WebP
   *   original — keep the input container; only resize/re-encode in-place
   */
  format: z.enum(IMAGE_FORMATS).default("auto"),
});

export type ImageProcessing = z.infer<typeof ImageProcessingSchema>;

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  /**
   * Natural language the agent should generate Markdown artifacts in.
   * Freeform — preset list is a UI convenience, not a constraint.
   */
  language: z.string().min(1).default("english"),
  /**
   * First-run wizard completion timestamp. Absent → user lands on
   * `/onboarding` instead of the home page. Set once and never cleared
   * automatically (user can re-run wizard from settings).
   */
  onboardedAt: z.string().optional(),
  /** User's display name (used in "Доброе утро, …" greetings). */
  userName: z.string().default(""),
  /** IANA timezone (e.g. "Europe/Moscow"). Used for daily-digest cadence. */
  timezone: z.string().default(""),
  /**
   * "simple" hides MCP, allowed-tools editor, prompt-template editor,
   * harness assignments etc. — anything that requires CS background.
   * "advanced" shows the full settings surface. Default "simple".
   */
  uiMode: z.enum(["simple", "advanced"]).default("simple"),
  imageProcessing: ImageProcessingSchema.default({
    enabled: true,
    maxDimension: 2000,
    quality: 85,
    format: "auto",
  }),
  harnesses: HarnessesSchema.default({
    "claude-code": { enabled: true },
    codex: { enabled: true },
    ollama: { enabled: true, baseUrl: "http://localhost:11434" },
  }),
  assignments: z
    .object({
      analyze: AssignmentSchema,
      chat: AssignmentSchema,
      rag: AssignmentSchema,
      embed: AssignmentSchema,
      quick: AssignmentSchema,
    })
    .default({
      analyze: {
        harness: "claude-code",
        model: "claude-opus-4-7",
        allowedTools: [
          "Read",
          "Write",
          "Edit",
          "LS",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
        ],
      },
      chat: {
        harness: "claude-code",
        model: "claude-sonnet-4-6",
        allowedTools: [
          "Read",
          "LS",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
        ],
      },
      rag: { harness: "ollama", model: "llama3.1:8b", allowedTools: [] },
      embed: { harness: "ollama", model: "nomic-embed-text", allowedTools: [] },
      quick: {
        harness: "claude-code",
        model: "claude-haiku-4-5",
        allowedTools: [],
      },
    }),
  /**
   * Which map/routing services appear in the map-widget's "Маршрут в…"
   * popup. Free-form string ids so users can add custom providers later
   * without a schema migration; UI maps known ids to MAP_SERVICES entries
   * (see `lib/client/map-services.ts`).
   */
  mapServices: z
    .object({
      enabled: z.array(z.string()).default(["google", "yandex", "apple", "osm"]),
    })
    .default({
      enabled: ["google", "yandex", "apple", "osm"],
    }),
  /**
   * Ngrok integration — used to make selected utilities/KB/projects
   * available on the public internet (see `lib/server/shares/*`). Reflex
   * spawns the `ngrok` CLI binary; it must be installed on PATH. Auth
   * fields are stored verbatim — keep them out of source control.
   */
  ngrok: z
    .object({
      /** Token used by `ngrok config add-authtoken` to authenticate the agent. */
      authtoken: z.string().default(""),
      /** Account API key (separate from authtoken); needed only to list reserved domains. */
      apiKey: z.string().default(""),
      /** Reserved domain to attach to the tunnel. Empty = let ngrok assign a random subdomain. */
      domain: z.string().default(""),
      /** Local port the tunnel forwards to. Defaults to 3210 (Reflex dev). */
      port: z.number().int().min(1).max(65535).default(3210),
    })
    .default({
      authtoken: "",
      apiKey: "",
      domain: "",
      port: 3210,
    }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
