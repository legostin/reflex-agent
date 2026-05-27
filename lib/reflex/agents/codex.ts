import { execa } from "execa";
import { promises as fs } from "node:fs";
import {
  type AgentBackend,
  type AnalyzeScope,
  type ChatScope,
  AgentUnavailableError,
} from "./backend.js";
import { analyzePrompt, chatSystemPrompt } from "./prompts.js";

const CLI = "codex";

export const codexBackend: AgentBackend = {
  id: "codex",

  async analyzeScope(scope: AnalyzeScope): Promise<void> {
    await ensureCliAvailable();
    await fs.mkdir(scope.reflexScope, { recursive: true });
    const prompt = await analyzePrompt(scope);
    const args = [
      "exec",
      "--cd",
      scope.root,
      "--sandbox",
      "workspace-write",
      "--add-dir",
      scope.reflexScope,
    ];
    if (scope.model) args.push("--model", scope.model);
    args.push(prompt);
    // `codex exec` runs non-interactively. We grant write access to the
    // reflex scope only; codex defaults to read-only outside its cwd, which we
    // set to the project root so it can read sources.
    await execa(CLI, args, { stdio: "inherit" });
  },

  async chat(scope: ChatScope): Promise<void> {
    await ensureCliAvailable();
    const system = await chatSystemPrompt(scope);
    await execa(CLI, ["--system", system], {
      cwd: scope.scope,
      stdio: "inherit",
    });
  },
};

async function ensureCliAvailable(): Promise<void> {
  try {
    await execa(CLI, ["--version"], { stdio: "ignore" });
  } catch (err) {
    throw new AgentUnavailableError("codex", err);
  }
}
