"use server";

import { listRoots, type RegistryEntry } from "@/lib/registry";

export type ListRootsResult =
  | { ok: true; entries: RegistryEntry[] }
  | { ok: false; error: string };

export async function listRootsAction(): Promise<ListRootsResult> {
  try {
    const entries = await listRoots();
    return { ok: true, entries };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
