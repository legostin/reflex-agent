import "server-only";
import { getApiKey } from "@/lib/server/api-keys";

/**
 * Gemini text-to-speech. The model returns 16-bit PCM (mono, usually 24 kHz)
 * as inline base64; we wrap it in a WAV container (every browser plays WAV).
 *
 * Billed to the user's Gemini API key — not free. Voices are the prebuilt
 * Gemini set (Kore, Puck, Charon, …); models are the *-tts variants.
 */
export async function geminiTts(args: {
  text: string;
  voice: string;
  model: string;
}): Promise<{ wav: Buffer }> {
  const key = await getApiKey("gemini");
  if (!key) {
    throw new Error(
      "Gemini API key is not configured. Open Settings → Gemini.",
    );
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model,
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: args.text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: args.voice } },
      },
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini TTS ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };
  const part = json?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.data,
  );
  if (!part?.inlineData?.data) {
    const reason = json?.candidates?.[0]?.finishReason ?? "no audio returned";
    throw new Error(`Gemini returned no audio (${reason})`);
  }
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const rate = /rate=(\d+)/.exec(part.inlineData.mimeType ?? "");
  return { wav: pcmToWav(pcm, rate ? parseInt(rate[1]!, 10) : 24000) };
}

/** Wrap raw little-endian 16-bit mono PCM in a minimal WAV container. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
