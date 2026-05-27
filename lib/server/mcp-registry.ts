import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  McpConfigSchema,
  type McpConfig,
} from "@/lib/server/utilities/mcp";

/**
 * Reflex-wide MCP server registry. One JSON file at
 *   ~/.reflex/mcp/servers.json
 * holds every MCP server the user has registered (named + transport config).
 * Utilities reference servers by `id` from their manifest; the chat
 * orchestrator gets all of them passed via `--mcp-config` to its CLI harness.
 *
 * Why a registry instead of per-utility configs:
 *   - The same server (e.g. github, gcal) is reused across many utilities
 *     AND the chat — duplicating commands/env per utility is brittle.
 *   - User edits config in ONE place when credentials change.
 *   - Permission model becomes "this utility may use servers X, Y" rather
 *     than "this utility owns this MCP config".
 */

const REGISTRY_DIR = path.join(os.homedir(), ".reflex", "mcp");
const REGISTRY_FILE = path.join(REGISTRY_DIR, "servers.json");

export const McpServerEntrySchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_-]*$/,
      "id must start with a letter; letters, digits, '_' and '-' allowed",
    ),
  label: z.string().min(1).max(120),
  description: z.string().max(2_000).default(""),
  config: McpConfigSchema,
  addedAt: z.string(),
  /** Last time we successfully fetched tools/list from this server. */
  lastVerifiedAt: z.string().optional(),
});

export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

const RegistrySchema = z.object({
  version: z.literal(1),
  servers: z.array(McpServerEntrySchema),
});

interface RegistryFile {
  version: 1;
  servers: McpServerEntry[];
}

async function read(): Promise<RegistryFile> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, "utf8");
    const parsed = RegistrySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { version: 1, servers: [] };
    return parsed.data;
  } catch {
    return { version: 1, servers: [] };
  }
}

async function write(data: RegistryFile): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  await fs.writeFile(
    REGISTRY_FILE,
    JSON.stringify(data, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    await fs.chmod(REGISTRY_FILE, 0o600);
  } catch {
    // best effort
  }
}

export async function listMcpServers(): Promise<McpServerEntry[]> {
  const r = await read();
  return [...r.servers].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getMcpServer(id: string): Promise<McpServerEntry | null> {
  const r = await read();
  return r.servers.find((s) => s.id === id) ?? null;
}

export async function addMcpServer(args: {
  id: string;
  label: string;
  description?: string;
  config: McpConfig;
}): Promise<McpServerEntry> {
  const entry: McpServerEntry = McpServerEntrySchema.parse({
    id: args.id,
    label: args.label,
    description: args.description ?? "",
    config: args.config,
    addedAt: new Date().toISOString(),
  });
  const r = await read();
  if (r.servers.some((s) => s.id === entry.id)) {
    throw new Error(`MCP server "${entry.id}" already exists`);
  }
  r.servers.push(entry);
  await write(r);
  return entry;
}

export async function updateMcpServer(
  id: string,
  patch: Partial<Pick<McpServerEntry, "label" | "description" | "config" | "lastVerifiedAt">>,
): Promise<McpServerEntry> {
  const r = await read();
  const idx = r.servers.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`MCP server "${id}" not found`);
  const merged: McpServerEntry = McpServerEntrySchema.parse({
    ...r.servers[idx],
    ...patch,
  });
  r.servers[idx] = merged;
  await write(r);
  return merged;
}

export async function removeMcpServer(id: string): Promise<void> {
  const r = await read();
  const next = r.servers.filter((s) => s.id !== id);
  if (next.length === r.servers.length) return;
  r.servers = next;
  await write(r);
}
