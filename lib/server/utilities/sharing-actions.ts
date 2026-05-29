"use server";

import {
  listGrantViews,
  revokeGrant,
  createGrant,
  type GrantView,
  type SharePlane,
} from "./grant-store";
import { listProviders, type ProviderEntry } from "./provider-directory";

/**
 * Server actions for the Settings → Sharing surface (docs/sharing.md, Stage 4).
 * Thin wrappers over the grant ledger + provider directory so a UI can show
 * every live cross-utility grant and revoke any of them, and browse what each
 * installed utility provides. Grants are created elsewhere (install / JIT
 * consent) — never here — keeping core the sole, consented broker.
 */

export async function listGrantsAction(): Promise<GrantView[]> {
  return listGrantViews();
}

export async function revokeGrantAction(id: string): Promise<{ ok: boolean }> {
  return { ok: await revokeGrant(id) };
}

export async function listProvidersAction(): Promise<ProviderEntry[]> {
  return listProviders();
}

/**
 * Create a grant after the user approves a just-in-time consent prompt
 * (the host-rendered dialog in the utility iframe wrapper). The UI consent IS
 * the authorization here — this is a single-user, local-first app, and the
 * prompt is rendered by the host, not the requesting utility, so it can't be
 * spoofed. Idempotent via the underlying store.
 */
export async function requestGrantAction(input: {
  consumer: string;
  provider: string;
  plane: SharePlane;
  selector: string;
  scope: string;
}): Promise<{ ok: boolean }> {
  if (input.plane !== "data" && input.plane !== "capability") {
    return { ok: false };
  }
  await createGrant(input);
  return { ok: true };
}
