import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runHeadlessAgent } from "@/lib/server/agents/headless";
import { getRoot } from "@/lib/registry";

/**
 * Vision-based image judgment that goes through the user's **main chat
 * harness** (Codex or Claude Code — both have native vision support
 * through their Read tool when opening image files). No Gemini-specific
 * code: whichever harness the user picked in Settings → Chat handles
 * the picking, so vision quality scales with their model choice.
 *
 * Flow:
 *   1. Download N thumbnails to a per-call tmp dir.
 *   2. Spawn a headless agent with the paths attached.
 *   3. Agent uses Read tool on each file → native vision content.
 *   4. Parses JSON `{pick, reason}` from the agent's reply.
 *   5. Cleans up the tmp dir.
 *
 * The original text-only judge couldn't distinguish a hand from a
 * plaster-sphere photo — only the metadata (URL/source). With real
 * vision the agent sees the actual content and rejects mismatches.
 */

export interface JudgeCandidate {
  url: string;
  thumb: string;
  attribution: { name: string; link: string };
}

export interface PickBestInput {
  /** Root id used for tmp scratch + audit context. */
  rootId: string;
  query: string;
  /** Russian description of what the picture SHOULD contain. */
  alt: string;
  /** Free-form course/module context to ground the judgement. */
  context: string;
  candidates: JudgeCandidate[];
}

export interface PickBestResult {
  pickIndex: number; // 0..N-1, or -1 for "reject all"
  reason: string;
  via: "agent" | "heuristic" | "fallback";
}

export async function pickBestImage(
  input: PickBestInput,
): Promise<PickBestResult> {
  if (input.candidates.length === 0) {
    return { pickIndex: -1, reason: "no candidates", via: "fallback" };
  }
  if (input.candidates.length === 1) {
    return { pickIndex: 0, reason: "only one candidate", via: "fallback" };
  }
  try {
    return await agentPick(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fb = heuristicPick(input);
    return { ...fb, reason: `agent judge failed (${reason}); ${fb.reason}` };
  }
}

async function agentPick(input: PickBestInput): Promise<PickBestResult> {
  const entry = await getRoot(input.rootId);
  if (!entry) throw new Error(`unknown rootId: ${input.rootId}`);

  // 1. Download thumbnails. Per-call dir so concurrent judges don't
  // collide. Scratch lives under the project's .reflex/.tmp/ so the
  // root's sandbox sees them.
  const tmpDir = path.join(
    entry.path,
    ".reflex",
    ".tmp",
    `judge-${crypto.randomBytes(6).toString("hex")}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });

  const downloaded = await Promise.all(
    input.candidates.map(async (c, i) => {
      try {
        const res = await fetch(c.thumb, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const mime =
          res.headers.get("content-type")?.split(";")[0]?.trim() ||
          "image/jpeg";
        if (!mime.startsWith("image/")) return null;
        const arr = await res.arrayBuffer();
        if (arr.byteLength > 5 * 1024 * 1024) return null; // 5MB cap
        const ext = mimeToExt(mime);
        const filePath = path.join(tmpDir, `cand-${i}.${ext}`);
        await fs.writeFile(filePath, Buffer.from(arr));
        return { index: i, path: filePath, mime, size: arr.byteLength };
      } catch {
        return null;
      }
    }),
  );
  const usable = downloaded.filter(
    (d): d is { index: number; path: string; mime: string; size: number } =>
      d !== null,
  );
  if (usable.length === 0) {
    await cleanup(tmpDir);
    return heuristicPick(input);
  }

  // 2. Build a prompt that lists the paths and instructs the agent to
  // Read each (which returns image content for vision-capable models).
  const lines: string[] = [
    `Курс/тема: ${input.context}`,
    `Поисковый запрос: "${input.query}"`,
    `Что должно быть на картинке: ${input.alt}`,
    "",
    `На диске лежат ${usable.length} кандидатов поисковой выдачи. ОТКРОЙ КАЖДОГО через Read tool — он вернёт картинку как vision-контент, ты её увидишь:`,
    "",
  ];
  for (let i = 0; i < usable.length; i++) {
    const c = input.candidates[usable[i]!.index]!;
    let host = "(unknown)";
    try {
      host = new URL(c.url).hostname;
    } catch {
      /* keep */
    }
    lines.push(
      `  [${i}] ${usable[i]!.path}  (источник: ${host}, автор: ${c.attribution.name})`,
    );
  }
  lines.push(
    "",
    "Прочитай каждую (Read tool, по одной), посмотри что РЕАЛЬНО на картинке, выбери одну ЛУЧШЕ ВСЕГО подходящую как учебная иллюстрация.",
    "",
    "Критерии (в порядке важности):",
    "  1. На картинке РЕАЛЬНО изображено то, что просит запрос. Например, если запрос «гипсовый шар», а на картинке рука — отклоняй.",
    "  2. Качество годится для учебника: не клипарт, не мем, не logo, не размытое.",
    "  3. Контекст соответствует теме курса.",
    "  4. Если ВСЕ кандидаты не подходят — верни pick: -1, тогда система сгенерирует AI-иллюстрацию вместо подобранной.",
    "",
    `В САМОМ КОНЦЕ ответа выведи ОДНУ строку с JSON: {"pick": число от 0 до ${usable.length - 1} ИЛИ -1, "reason": "коротко по-русски"}`,
    "До этой строки можешь думать вслух / описывать что видишь — мне важна только последняя JSON-строка.",
  );

  // 3. Run through user's chat harness. Generous timeout because vision
  // + multi-Read can take a couple minutes on slow models.
  const attachments = usable.map((u) => ({
    name: path.basename(u.path),
    absPath: u.path,
    size: u.size,
    mime: u.mime,
  }));
  let pickIdx = -1;
  let reason = "";
  try {
    const result = await runHeadlessAgent({
      rootId: input.rootId,
      prompt: lines.join("\n"),
      label: `[images.pickBest] ${input.query}`,
      timeoutMs: 5 * 60_000,
      attachments,
    });
    const parsed = parsePick(result.text, usable.length);
    pickIdx = parsed.pickIndex;
    reason = parsed.reason;
  } finally {
    await cleanup(tmpDir);
  }

  // Map back from "shown index" → original candidate index.
  if (pickIdx === -1) {
    return { pickIndex: -1, reason: reason || "agent rejected all", via: "agent" };
  }
  if (pickIdx < 0 || pickIdx >= usable.length) {
    return {
      pickIndex: usable[0]!.index,
      reason: `agent returned invalid pick (${pickIdx}); falling back to first usable`,
      via: "agent",
    };
  }
  return {
    pickIndex: usable[pickIdx]!.index,
    reason,
    via: "agent",
  };
}

function parsePick(
  text: string,
  count: number,
): { pickIndex: number; reason: string } {
  // Scan from the END for the last JSON-looking line — judge prompt
  // says "the LAST line is the JSON". Falls back to first JSON in body.
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as { pick?: unknown; reason?: unknown };
      const p =
        typeof parsed.pick === "number" && Number.isInteger(parsed.pick)
          ? parsed.pick
          : NaN;
      if (Number.isFinite(p) && (p === -1 || (p >= 0 && p < count))) {
        return {
          pickIndex: p,
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
        };
      }
    } catch {
      /* try previous line */
    }
  }
  // Fallback: greedy regex over the full text.
  const match = /\{[^{}]*"pick"[^{}]*\}/.exec(text);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { pick?: unknown; reason?: unknown };
      const p =
        typeof parsed.pick === "number" && Number.isInteger(parsed.pick)
          ? parsed.pick
          : NaN;
      if (Number.isFinite(p)) {
        return {
          pickIndex: p === -1 || (p >= 0 && p < count) ? p : 0,
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
        };
      }
    } catch {
      /* fall through */
    }
  }
  return { pickIndex: 0, reason: "could not parse pick from agent reply" };
}

function heuristicPick(input: PickBestInput): PickBestResult {
  const TRUSTED = /(wikipedia|wikimedia|britannica|mdn|github|stanford|mit\.edu|nature\.com|nasa\.gov|noaa\.gov|smithsonian)/i;
  for (let i = 0; i < input.candidates.length; i++) {
    const c = input.candidates[i]!;
    try {
      const host = new URL(c.url).hostname;
      if (TRUSTED.test(host)) {
        return {
          pickIndex: i,
          reason: `trusted domain ${host}`,
          via: "heuristic",
        };
      }
    } catch {
      /* skip */
    }
  }
  return {
    pickIndex: 0,
    reason: "no trusted domain; first result",
    via: "heuristic",
  };
}

function mimeToExt(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    default:
      return "img";
  }
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
