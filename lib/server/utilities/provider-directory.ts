import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { reflexHome } from "@/lib/reflex/home";
import { writeJsonFile } from "@/lib/reflex/store/json-store";

/**
 * The Share Plane provider directory (see docs/sharing.md). Lives at
 * `<REFLEX_HOME>/providers.json`, rebuilt from installed manifests on every
 * install/uninstall (self-healing). It records, per utility, the data kinds it
 * provides and the verbs it exports, plus a kind-OWNERSHIP map (first-claim-
 * wins). Discovery (`capabilities.listProviders`) reads metadata only — never
 * payloads — so a consumer can find a provider by interface BEFORE it can read
 * anything.
 */

export interface ProvidedData {
  kind: string;
  doc?: string;
  read: boolean;
}

export interface ProvidedCapability {
  verb: string;
  /** serverAction name in the provider's manifest. */
  action: string;
  doc?: string;
  sideEffects: boolean;
  confirm: boolean;
  input: Record<string, string>;
  output: Record<string, string>;
}

export interface ProviderEntry {
  provider: string;
  scope: "global" | "project";
  rootId?: string;
  version: string;
  data: ProvidedData[];
  capabilities: ProvidedCapability[];
}

/** What `rebuildProviderDirectory` consumes — one entry per installed utility. */
export interface ProviderInput {
  id: string;
  scope: "global" | "project";
  rootId?: string;
  version: string;
  provides?: {
    data?: ProvidedData[];
    capabilities?: ProvidedCapability[];
  };
}

interface DirectoryFile {
  version: number;
  providers: ProviderEntry[];
  /** kind -> owning provider id (first-claim-wins). */
  owners: Record<string, string>;
}

function providersFile(): string {
  return path.join(reflexHome(), "providers.json");
}

async function readFile(): Promise<DirectoryFile> {
  try {
    const raw = await fs.readFile(providersFile(), "utf8");
    const parsed = JSON.parse(raw) as DirectoryFile;
    if (parsed && Array.isArray(parsed.providers) && parsed.owners) return parsed;
  } catch {
    /* missing / corrupt */
  }
  return { version: 1, providers: [], owners: {} };
}

async function writeFile(file: DirectoryFile): Promise<void> {
  await writeJsonFile(providersFile(), file);
}

/**
 * Rebuild the directory from the full set of installed utilities. Ownership is
 * preserved across rebuilds (first-claim-wins): a kind keeps its owner while
 * that owner still provides it; if the owner is gone (uninstalled) or no longer
 * provides the kind, the kind is reassigned to the first current provider, or
 * released if none remain.
 */
export async function rebuildProviderDirectory(
  utils: ProviderInput[],
): Promise<void> {
  const prev = await readFile();
  const providers: ProviderEntry[] = [];
  for (const u of utils) {
    const data = u.provides?.data ?? [];
    const capabilities = u.provides?.capabilities ?? [];
    if (data.length === 0 && capabilities.length === 0) continue;
    providers.push({
      provider: u.id,
      scope: u.scope,
      ...(u.rootId ? { rootId: u.rootId } : {}),
      version: u.version,
      data,
      capabilities,
    });
  }

  // Which providers currently claim each kind, in install order.
  const claimants = new Map<string, string[]>();
  for (const p of providers) {
    for (const d of p.data) {
      const list = claimants.get(d.kind) ?? [];
      list.push(p.provider);
      claimants.set(d.kind, list);
    }
  }

  const owners: Record<string, string> = {};
  for (const [kind, list] of claimants) {
    const prevOwner = prev.owners[kind];
    // Keep the prior owner if it still claims the kind; else first claimant.
    owners[kind] = prevOwner && list.includes(prevOwner) ? prevOwner : list[0]!;
  }

  await writeFile({ version: 1, providers, owners });
}

export async function listProviders(filter?: {
  kind?: string;
  verb?: string;
}): Promise<ProviderEntry[]> {
  const { providers } = await readFile();
  return providers.filter((p) => {
    if (filter?.kind && !p.data.some((d) => d.kind === filter.kind)) return false;
    if (filter?.verb && !p.capabilities.some((c) => c.verb === filter.verb))
      return false;
    return true;
  });
}

/** The provider id that owns a kind, or null if unclaimed. */
export async function getKindOwner(kind: string): Promise<string | null> {
  const { owners } = await readFile();
  return owners[kind] ?? null;
}

export async function getProviderEntry(
  provider: string,
  rootId?: string,
): Promise<ProviderEntry | null> {
  const { providers } = await readFile();
  // Prefer a project-scoped match for this root; fall back to a global one.
  return (
    providers.find((p) => p.provider === provider && p.rootId === rootId) ??
    providers.find((p) => p.provider === provider) ??
    null
  );
}

export async function findProviderCapability(
  provider: string,
  verb: string,
  rootId?: string,
): Promise<{ entry: ProviderEntry; capability: ProvidedCapability } | null> {
  const entry = await getProviderEntry(provider, rootId);
  if (!entry) return null;
  const capability = entry.capabilities.find((c) => c.verb === verb);
  return capability ? { entry, capability } : null;
}
