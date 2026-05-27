import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listMcpServers } from "@/lib/server/mcp-registry";
import { hydrateOAuthValues } from "@/lib/server/utilities/mcp";

/**
 * Materialize Reflex's MCP registry into a temporary JSON file in the shape
 * Claude Code expects for `--mcp-config`. Each entry becomes:
 *
 *   {
 *     "mcpServers": {
 *       "<id>": {
 *         "command": "...",
 *         "args": ["..."],
 *         "env": {...}
 *       }
 *     }
 *   }
 *
 * Returns the file path + a `cleanup()` callback so the caller can delete
 * the file once the subprocess exits.
 */
export async function writeClaudeMcpConfig(
  agentId: string,
): Promise<{ path: string; serverIds: string[]; cleanup: () => Promise<void> } | null> {
  const servers = await listMcpServers();
  if (servers.length === 0) return null;
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (s.config.transport === "stdio") {
      const env = await hydrateOAuthValues(s.config.env);
      mcpServers[s.id] = {
        command: s.config.command,
        args: s.config.args,
        env,
      };
    } else if (s.config.transport === "http") {
      const headers = await hydrateOAuthValues(s.config.headers);
      mcpServers[s.id] = {
        type: "http",
        url: s.config.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    } else {
      const headers = await hydrateOAuthValues(s.config.headers);
      mcpServers[s.id] = {
        type: "sse",
        url: s.config.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `reflex-mcp-${agentId}-`));
  const target = path.join(dir, "mcp.json");
  await fs.writeFile(target, JSON.stringify({ mcpServers }, null, 2), "utf8");
  return {
    path: target,
    serverIds: servers.map((s) => s.id),
    cleanup: async () => {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}
