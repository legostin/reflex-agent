"use server";

import { loadSettings } from "@/lib/settings/store";

/**
 * Return just the list of enabled map-service ids. Used by the map widget
 * to figure out which routing providers to show in the per-pin popup,
 * without pulling down the whole settings blob over RPC every render.
 */
export async function getEnabledMapServicesAction(): Promise<{
  ok: true;
  enabled: string[];
}> {
  const settings = await loadSettings();
  return { ok: true, enabled: settings.mapServices.enabled };
}
