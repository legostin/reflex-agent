"use server";

import { revalidatePath } from "next/cache";
import { loadSettings, saveSettings } from "@/lib/settings/store";
import type { Settings } from "@/lib/settings";
import {
  listReservedDomains,
  ngrokVersion,
  pollPublicUrl,
  startTunnel,
  stopTunnel,
  tunnelStatus,
  type TunnelStatus,
} from "./cli";

/**
 * Bootstrapping helpers for the Reflex ngrok integration. The settings
 * action surfaces the tunnel state to the UI in one round-trip and lets
 * the user start/stop the tunnel + refresh the reserved-domain list.
 */

export async function getTunnelStatusAction(): Promise<{
  status: TunnelStatus;
  cliVersion: string | null;
  publicHost: string | null;
}> {
  const status = tunnelStatus();
  const cliVersion = await ngrokVersion();
  const publicHost = process.env.REFLEX_NGROK_HOST ?? null;
  return { status, cliVersion, publicHost };
}

export async function startTunnelAction(): Promise<
  { ok: true; publicUrl: string | null } | { ok: false; error: string }
> {
  const s = await loadSettings();
  if (!s.ngrok.authtoken) {
    return {
      ok: false,
      error: "ngrok.authtoken пуст — заполни в настройках сверху.",
    };
  }
  const r = await startTunnel({
    port: s.ngrok.port,
    authtoken: s.ngrok.authtoken,
    ...(s.ngrok.domain ? { domain: s.ngrok.domain } : {}),
  });
  if (!r.ok) return r;
  const publicUrl = await pollPublicUrl();
  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      process.env.REFLEX_NGROK_HOST = url.host;
    } catch {
      /* ignore — publicUrl is informational */
    }
  }
  revalidatePath("/settings");
  return { ok: true, publicUrl };
}

export async function stopTunnelAction(): Promise<{ ok: boolean }> {
  const ok = await stopTunnel();
  delete process.env.REFLEX_NGROK_HOST;
  revalidatePath("/settings");
  return { ok };
}

/**
 * Persist a partial update to settings.ngrok without going through the
 * main settings-form save flow. The ngrok panel needs immediate disk
 * writes so the user doesn't have to click "Save settings" at the top
 * before the tunnel-start action can see the new authtoken.
 */
export async function patchNgrokSettingsAction(
  patch: Partial<Settings["ngrok"]>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const current = await loadSettings();
    const next: Settings = {
      ...current,
      ngrok: { ...current.ngrok, ...patch },
    };
    await saveSettings(next);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function refreshReservedDomainsAction(): Promise<
  | {
      ok: true;
      domains: Array<{ id: string; domain: string; region: string }>;
    }
  | { ok: false; error: string }
> {
  const s = await loadSettings();
  return listReservedDomains(s.ngrok.apiKey);
}
