"use server";

import {
  getApiKey,
  hasApiKey,
  patchApiKeyMeta,
  saveApiKey,
  type ApiKeyProvider,
} from "./api-keys";
import {
  geminiGenerateContent,
  listGeminiModels,
  resolveGeminiModel,
  type GeminiModel,
} from "./llm/gemini";
import { loadSettings } from "@/lib/settings/store";

/**
 * Summarize a YouTube video via Gemini's multimodal API. Gemini ingests the
 * YouTube URL directly (it pulls the video server-side, no transcript
 * extraction needed). Returns the model's text response.
 *
 * If the user hasn't saved a Gemini key yet, we return `{needsKey: true}`
 * so the caller can render an inline "paste your key" prompt — same UX
 * pattern we use for MCP secrets and OAuth client setup.
 */

export type SummarizeYoutubeResult =
  | { ok: true; text: string; model: string }
  | { ok: false; needsKey: true; error: string }
  | { ok: false; needsKey?: false; error: string };

export async function summarizeYoutubeAction(args: {
  url: string;
  /** Optional override; otherwise a sensible default in the user's language. */
  prompt?: string;
  /** Override model for this single call (without changing saved preference). */
  modelOverride?: string;
}): Promise<SummarizeYoutubeResult> {
  const apiKey = await getApiKey("gemini");
  if (!apiKey) {
    return {
      ok: false,
      needsKey: true,
      error:
        "Gemini API key не сохранён — введи его, чтобы суммаризировать видео.",
    };
  }
  const settings = await loadSettings();
  const language = settings.language ?? "russian";
  const prompt = args.prompt?.trim() || defaultPrompt(language);
  const model =
    args.modelOverride?.trim() || (await resolveGeminiModel("video"));
  try {
    const { text } = await geminiGenerateContent({
      model,
      apiKey,
      contents: [
        {
          parts: [
            {
              file_data: { file_uri: args.url, mime_type: "video/*" },
            },
            { text: prompt },
          ],
        },
      ],
    });
    if (!text) {
      return {
        ok: false,
        error:
          "Gemini вернул пустой ответ — возможно видео недоступно или приватное.",
      };
    }
    return { ok: true, text, model };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveGeminiKeyAction(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!apiKey.trim()) {
      return { ok: false, error: "API key is empty" };
    }
    await saveApiKey("gemini", apiKey);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function hasApiKeyAction(
  provider: ApiKeyProvider,
): Promise<{ ok: true; present: boolean }> {
  return { ok: true, present: await hasApiKey(provider) };
}

export type ListGeminiModelsResult =
  | {
      ok: true;
      models: Array<
        Pick<
          GeminiModel,
          | "id"
          | "displayName"
          | "description"
          | "inputTokenLimit"
          | "outputTokenLimit"
        >
      >;
      currentModel: string;
      currentVideoModel: string;
    }
  | { ok: false; error: string };

export async function listGeminiModelsAction(
  refresh = false,
): Promise<ListGeminiModelsResult> {
  try {
    const models = await listGeminiModels({ refresh });
    return {
      ok: true,
      models: models.map((m) => ({
        id: m.id,
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.description ? { description: m.description } : {}),
        ...(m.inputTokenLimit !== undefined
          ? { inputTokenLimit: m.inputTokenLimit }
          : {}),
        ...(m.outputTokenLimit !== undefined
          ? { outputTokenLimit: m.outputTokenLimit }
          : {}),
      })),
      currentModel: await resolveGeminiModel("general"),
      currentVideoModel: await resolveGeminiModel("video"),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveGeminiModelChoiceAction(args: {
  model?: string | null;
  videoModel?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await patchApiKeyMeta("gemini", args);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function defaultPrompt(language: string): string {
  const isRu = /russ/i.test(language) || /рус/i.test(language);
  if (isRu) {
    return [
      "Сделай структурированную выжимку этого YouTube-видео:",
      "",
      "1. Один абзац — о чём видео целиком и для кого.",
      "2. Главные тезисы списком с тайм-кодами вида `[mm:ss]`.",
      "3. Ключевые цитаты (если есть запоминающиеся фразы) — с тайм-кодами.",
      "4. Если показаны диаграммы / схемы / код — кратко опиши что в них.",
      "5. Вывод 1-3 предложения: главное, что стоит унести.",
      "",
      "Пиши на русском, лаконично. Без воды.",
    ].join("\n");
  }
  return [
    "Produce a structured summary of this YouTube video:",
    "",
    "1. One paragraph — what the video is about and who it's for.",
    "2. Main points as a bulleted list with `[mm:ss]` timestamps.",
    "3. Notable quotes (if any) with timestamps.",
    "4. If diagrams / slides / code are shown — briefly describe them.",
    "5. 1-3 sentence takeaway.",
    "",
    "Be concise. No filler.",
  ].join("\n");
}
