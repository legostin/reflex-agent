import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { z } from "zod";

/**
 * Adapter that wraps an MCP server (stdio subprocess OR remote HTTP/SSE
 * endpoint) as a Reflex utility. `connectAndListTools` is used at install
 * time to discover the server's capabilities so we can generate a UI;
 * `callTool` is used by the generated server action at runtime.
 *
 * We deliberately open a fresh client per call. MCP stdio servers are
 * cheap to spawn and this sidesteps any session-management complexity
 * inside a Next.js dev server with HMR-resetting module state. For HTTP
 * transports the cost is also low (one initialize round-trip).
 */

export const McpStdioConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
});

export const McpHttpConfigSchema = z.object({
  transport: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const McpSseConfigSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const McpConfigSchema = z.discriminatedUnion("transport", [
  McpStdioConfigSchema,
  McpHttpConfigSchema,
  McpSseConfigSchema,
]);

export type McpConfig = z.infer<typeof McpConfigSchema>;

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
  tools: McpToolSpec[];
}

const CLIENT_INFO = { name: "reflex-utility-bridge", version: "0.1.0" };

async function openClient(config: McpConfig): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const client = new Client(CLIENT_INFO);
  if (config.transport === "stdio") {
    const env = await hydrateOAuthValues(config.env);
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...env } as Record<string, string>,
      cwd: config.cwd,
    });
    await client.connect(transport);
    return { client, close: () => client.close() };
  }
  if (config.transport === "http") {
    const headers = await hydrateOAuthValues(config.headers);
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    });
    await client.connect(transport);
    return { client, close: () => client.close() };
  }
  const headers = await hydrateOAuthValues(config.headers);
  const transport = new SSEClientTransport(new URL(config.url), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

/**
 * Replace `$oauth:<provider>` (or `Bearer $oauth:<provider>`) placeholders
 * in env/headers maps with the current access token. Token is refreshed
 * on the fly if expired; on failure we surface the error so the user
 * knows to re-authorize.
 */
const OAUTH_PLACEHOLDER = /\$oauth:([a-z][a-z0-9-]*)/g;

export async function hydrateOAuthValues(
  map: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(map)) {
    if (typeof raw !== "string" || !raw.includes("$oauth:")) {
      out[k] = raw;
      continue;
    }
    const providers = new Set<string>();
    raw.replace(OAUTH_PLACEHOLDER, (_, p) => {
      providers.add(p);
      return "";
    });
    let resolved = raw;
    const { getAccessToken } = await import("@/lib/server/oauth/flow");
    const { isOAuthProviderId } = await import(
      "@/lib/server/oauth/providers"
    );
    for (const p of providers) {
      if (!isOAuthProviderId(p)) {
        throw new Error(`unknown OAuth provider in placeholder: ${p}`);
      }
      const token = await getAccessToken(p);
      resolved = resolved.replace(new RegExp(`\\$oauth:${p}\\b`, "g"), token);
    }
    out[k] = resolved;
  }
  return out;
}

export async function connectAndListTools(
  config: McpConfig,
): Promise<McpServerInfo> {
  const { client, close } = await openClient(config);
  try {
    const serverInfo = client.getServerVersion();
    const { tools } = await client.listTools();
    return {
      name: serverInfo?.name,
      version: serverInfo?.version,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  } finally {
    await close().catch(() => {});
  }
}

export async function callTool(
  config: McpConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  isError?: boolean;
  content: unknown;
}> {
  const { client, close } = await openClient(config);
  try {
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: typeof result.isError === "boolean" ? result.isError : undefined,
      content: result.content,
    };
  } finally {
    await close().catch(() => {});
  }
}
