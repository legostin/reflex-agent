import "server-only";
import { execa } from "execa";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ingestFile,
  saveFileBytes,
  type StoredFile,
} from "@/lib/server/assets/file-store";
import { loadSettings } from "@/lib/settings/store";

/**
 * Text-to-speech, run IN the Reflex process (unsandboxed) via macOS `say`.
 *
 * Why here and not in the agent: the agent's harness sandbox (Codex
 * workspace-write, claude-code) blocks the system speech daemon, so `say -o`
 * / AVSpeechSynthesizer there produce silent/empty files. `say` works fine
 * unsandboxed, so Reflex does the synthesis and the agent only supplies text
 * (it drops `<outbox>/<name>.tts.txt`; the outbox drainer calls this).
 *
 * Output is m4a (AAC) — small and playable in every browser's <audio>.
 */
export async function synthesizeSpeech(args: {
  rootId: string;
  text: string;
  voice?: string;
  /** Display/download name for the produced audio (e.g. "greeting.m4a"). */
  name?: string;
}): Promise<StoredFile> {
  const text = args.text.trim();
  if (!text) throw new Error("empty TTS text");
  const settings = await loadSettings().catch(() => null);
  // Gemini provider (billed): higher quality + voice selection.
  if (settings?.tts?.provider === "gemini") {
    const { geminiTts } = await import("./providers/gemini-tts");
    const { wav } = await geminiTts({
      text,
      voice: settings.tts.geminiVoice,
      model: settings.tts.geminiModel,
    });
    const base = (args.name ?? "speech").replace(/\.[^.]+$/, "") || "speech";
    return saveFileBytes(args.rootId, wav, "wav", `${base}.wav`);
  }
  // Default: macOS `say`, unsandboxed, free.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reflex-tts-"));
  const inFile = path.join(dir, "in.txt");
  const outFile = path.join(dir, "speech.m4a");
  try {
    // `-f <file>` avoids ARG_MAX limits on long text and any shell quoting.
    await fs.writeFile(inFile, text, "utf8");
    const sayArgs = ["-f", inFile, "-o", outFile];
    if (args.voice) sayArgs.unshift("-v", args.voice);
    await execa("say", sayArgs, { timeout: 120_000 });
    const name = args.name?.trim() || "speech.m4a";
    return await ingestFile(args.rootId, outFile, name);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Parse a `*.tts.txt` outbox file: an optional leading `voice: NAME` line,
 * then the text to speak.
 */
export function parseTtsFile(raw: string): { text: string; voice?: string } {
  const m = /^[ \t]*voice:[ \t]*(.+)\r?\n([\s\S]*)$/i.exec(raw);
  if (m) return { text: m[2]!.trim(), voice: m[1]!.trim() };
  return { text: raw.trim() };
}
