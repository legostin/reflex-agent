"use server";

import { revalidatePath } from "next/cache";
import {
  createShare,
  deleteShare,
  listShares,
} from "./store";
import type { Share, ShareKind } from "./types";

/**
 * Create a public share. The caller picks the kind + the relevant
 * reference fields. Returns the freshly minted share record (without
 * leaking the password hash).
 */
export async function createShareAction(input: {
  kind: ShareKind;
  rootId?: string;
  utilityScope?: "global" | "project";
  utilityId?: string;
  kbRelPath?: string;
  password?: string;
  expiresAt?: string;
  label?: string;
}): Promise<{ ok: true; share: Share } | { ok: false; error: string }> {
  try {
    if (input.kind === "utility" && (!input.utilityId || !input.utilityScope)) {
      return {
        ok: false,
        error: "share kind=utility requires utilityId + utilityScope",
      };
    }
    if (input.kind === "kb-file" && (!input.rootId || !input.kbRelPath)) {
      return { ok: false, error: "share kind=kb-file requires rootId + kbRelPath" };
    }
    if ((input.kind === "kb-tree" || input.kind === "project") && !input.rootId) {
      return { ok: false, error: `share kind=${input.kind} requires rootId` };
    }
    const share = await createShare(input);
    revalidatePath("/settings");
    return { ok: true, share };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listSharesAction(): Promise<{ shares: Share[] }> {
  const shares = await listShares();
  return { shares };
}

export async function deleteShareAction(id: string): Promise<{ ok: boolean }> {
  const ok = await deleteShare(id);
  revalidatePath("/settings");
  return { ok };
}
