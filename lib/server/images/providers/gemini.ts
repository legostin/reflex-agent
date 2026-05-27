import "server-only";
import { getApiKey } from "@/lib/server/api-keys";
import { saveImageBytes, type StoredImage } from "../store";

/**
 * Gemini 2.5 Flash Image (a.k.a. "Nano Banana"). The model emits inline
 * base64 PNG parts; we pluck the first one and write it to the per-root
 * store. Multi-image responses are squashed to the first part — callers
 * who want N images should call N times in parallel.
 */

const MODEL = "gemini-2.5-flash-image-preview";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export interface GeminiGenInput {
  rootId: string;
  prompt: string;
  aspectRatio?: string;
  referenceImageUrls?: string[];
}

export async function generateWithGemini(
  input: GeminiGenInput,
): Promise<StoredImage> {
  const key = await getApiKey("gemini");
  if (!key) {
    throw new Error(
      "Gemini API key is not configured. Open Settings → Gemini.",
    );
  }
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const url of input.referenceImageUrls ?? []) {
    const ref = await fetchAsInlineData(url);
    if (ref) parts.push({ inlineData: ref });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
  };
  if (input.aspectRatio) {
    body.generationConfig = { imageConfig: { aspectRatio: input.aspectRatio } };
  }
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini image API ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const out = pickFirstImagePart(json);
  if (!out) {
    const reason = json?.candidates?.[0]?.finishReason ?? "no image returned";
    const text = json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join(" ")
      ?.slice(0, 300);
    throw new Error(
      `Gemini вернул не-картинку (${reason})${text ? ": " + text : ""}`,
    );
  }
  const bytes = Buffer.from(out.data, "base64");
  return saveImageBytes(input.rootId, bytes, out.mime);
}

interface InlineDataPart {
  data: string;
  mimeType: string;
}
interface ContentPart {
  text?: string;
  inlineData?: InlineDataPart;
}
interface Candidate {
  content?: { parts?: ContentPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: Candidate[];
}

function pickFirstImagePart(
  json: GeminiResponse,
): { data: string; mime: string } | null {
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("image/")) {
        return { data: inline.data, mime: inline.mimeType };
      }
    }
  }
  return null;
}

async function fetchAsInlineData(
  url: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mime.startsWith("image/")) return null;
    const arr = await res.arrayBuffer();
    return { data: Buffer.from(arr).toString("base64"), mimeType: mime };
  } catch {
    return null;
  }
}
