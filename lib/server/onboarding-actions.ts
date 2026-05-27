"use server";

import { spawn } from "node:child_process";
import { revalidatePath } from "next/cache";
import { loadSettings, saveSettings } from "@/lib/settings/store";
import type { Settings } from "@/lib/settings";
import {
  applyTemplate,
  findTemplate,
  materializeSpace,
  defaultBaseDir,
} from "./templates/registry";

/**
 * Server actions powering the first-run wizard. Each step has its own
 * thin action so the client can give immediate feedback; the final
 * `runOnboardingAction` is the atomic apply step.
 *
 * Engine detection is best-effort — we don't fail the wizard if Claude
 * Code CLI is missing, we just surface the result to the UI which can
 * show a "doesn't look installed" warning + a learn-more link.
 */

export interface EngineDetectionResult {
  claudeCli: { available: boolean; version?: string };
  codexCli: { available: boolean; version?: string };
  ollama: { available: boolean; baseUrl: string; modelsCount?: number };
}

export async function detectEnginesAction(): Promise<EngineDetectionResult> {
  const settings = await loadSettings();
  const ollamaBase = settings.harnesses.ollama.baseUrl.replace(/\/$/, "");
  const [claude, codex, ollama] = await Promise.all([
    detectCli("claude"),
    detectCli("codex"),
    detectOllama(ollamaBase),
  ]);
  return {
    claudeCli: claude,
    codexCli: codex,
    ollama: { ...ollama, baseUrl: ollamaBase },
  };
}

/**
 * Probe a CLI binary by running `<bin> --version` with a 3s ceiling.
 * Shared between Claude Code and Codex — both expose a simple version
 * flag and we don't care about the exact format, only presence.
 */
async function detectCli(
  bin: string,
): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout?.on("data", (b: Buffer) => {
        out += b.toString();
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve({ available: false });
      }, 3000);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) {
          resolve({ available: true, version: out.trim() });
        } else {
          resolve({ available: false });
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ available: false });
      });
    } catch {
      resolve({ available: false });
    }
  });
}

async function detectOllama(
  baseUrl: string,
): Promise<{ available: boolean; modelsCount?: number }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { available: false };
    const json = (await res.json()) as { models?: unknown[] };
    return { available: true, modelsCount: json.models?.length ?? 0 };
  } catch {
    return { available: false };
  }
}

export interface OnboardingInput {
  userName: string;
  language: string;
  timezone: string;
  /**
   * Which AI engine routes the `chat` and `quick` assignments after the
   * wizard finishes. `claude` keeps the default (Claude Code), `codex`
   * switches to OpenAI's Codex CLI, `ollama` to the local model.
   */
  engine: "claude" | "codex" | "ollama";
  /** Selected template ids. */
  templates: string[];
}

export interface OnboardingResult {
  ok: boolean;
  error?: string;
  spacesCreated: number;
  widgetsCreated: number;
  topicsCreated: number;
  skillsInstalled: number;
}

/**
 * Atomic finalize. Writes settings (incl. onboardedAt) → for each
 * chosen template, creates a root under `~/Reflex/<folder>` and runs
 * its seed. Surfaces aggregate counts so the UI can show a satisfying
 * "вот что мы для тебя сделали" summary at the end.
 */
export async function runOnboardingAction(
  input: OnboardingInput,
): Promise<OnboardingResult> {
  try {
    const current = await loadSettings();
    const next: Settings = {
      ...current,
      language: input.language || current.language,
      userName: input.userName,
      timezone: input.timezone,
      onboardedAt: new Date().toISOString(),
      uiMode: current.uiMode ?? "simple",
    };
    // Switch user-facing assignments (`chat`, `quick`) to the picked
    // engine. We never touch `embed/rag/analyze` defaults — those have
    // separate optimal models. If the user picked an engine that turns
    // out to be missing the CLI/server, the assignments still write but
    // the first turn will fail loudly with a clear error.
    if (input.engine === "ollama") {
      next.assignments = {
        ...current.assignments,
        chat: {
          ...current.assignments.chat,
          harness: "ollama",
          model: current.assignments.chat.model || "llama3.1:8b",
        },
        quick: {
          ...current.assignments.quick,
          harness: "ollama",
          model: current.assignments.quick.model || "llama3.1:8b",
        },
      };
    } else if (input.engine === "codex") {
      next.assignments = {
        ...current.assignments,
        chat: {
          ...current.assignments.chat,
          harness: "codex",
          model: "gpt-5",
        },
        quick: {
          ...current.assignments.quick,
          harness: "codex",
          model: "gpt-5-mini",
        },
      };
    }
    await saveSettings(next);

    let spacesCreated = 0;
    let widgetsCreated = 0;
    let topicsCreated = 0;
    let skillsInstalled = 0;
    for (const id of input.templates) {
      const tpl = findTemplate(id);
      if (!tpl) continue;
      const space = await materializeSpace({ template: tpl });
      const counts = await applyTemplate(tpl, {
        rootPath: space.rootPath,
        settings: next,
      });
      spacesCreated++;
      widgetsCreated += counts.widgetsCreated;
      topicsCreated += counts.topicsCreated;
      skillsInstalled += counts.skillsInstalled;
    }
    revalidatePath("/");
    revalidatePath("/settings");
    return {
      ok: true,
      spacesCreated,
      widgetsCreated,
      topicsCreated,
      skillsInstalled,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      spacesCreated: 0,
      widgetsCreated: 0,
      topicsCreated: 0,
      skillsInstalled: 0,
    };
  }
}

/**
 * Read-only listing of available templates — used by the wizard's third
 * step to render the gallery. Returns the metadata-only projection so
 * the seed `build()` closures don't get serialized to the client.
 */
export async function listTemplatesAction(): Promise<
  Array<{ id: string; label: string; emoji: string; description: string }>
> {
  const { SPACE_TEMPLATES } = await import("./templates/registry");
  return SPACE_TEMPLATES.map(({ id, label, emoji, description }) => ({
    id,
    label,
    emoji,
    description,
  }));
}

export async function getBaseDirAction(): Promise<{ baseDir: string }> {
  return { baseDir: defaultBaseDir() };
}
