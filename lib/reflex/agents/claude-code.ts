import { execa } from "execa";
import { promises as fs } from "node:fs";
import {
  type AgentBackend,
  type AnalyzeScope,
  type ChatScope,
  AgentUnavailableError,
} from "./backend.js";
import { analyzePrompt, chatSystemPrompt } from "./prompts.js";

const CLI = "claude";

export const claudeCodeBackend: AgentBackend = {
  id: "claude-code",

  async analyzeScope(scope: AnalyzeScope): Promise<void> {
    await ensureCliAvailable();
    await fs.mkdir(scope.reflexScope, { recursive: true });
    const prompt = await analyzePrompt(scope);
    const args = [
      "-p",
      prompt,
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Write,Edit,LS,Glob,Grep",
      "--add-dir",
      scope.reflexScope,
    ];
    if (scope.model) args.push("--model", scope.model);
    // Headless agent run: Claude is allowed to write inside reflexScope and
    // read from the project root.
    await execa(CLI, args, {
      cwd: scope.root,
      stdio: "inherit",
    });
  },

  async chat(scope: ChatScope): Promise<void> {
    await ensureCliAvailable();
    const system = await chatSystemPrompt(scope);
    await execa(
      CLI,
      ["--append-system-prompt", system, "--add-dir", scope.reflexScope],
      {
        cwd: scope.scope,
        stdio: "inherit",
      },
    );
  },
};

async function ensureCliAvailable(): Promise<void> {
  try {
    await execa(CLI, ["--version"], { stdio: "ignore" });
  } catch (err) {
    throw new AgentUnavailableError("claude-code", err);
  }
}
