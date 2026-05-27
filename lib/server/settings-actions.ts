"use server";

import { revalidatePath } from "next/cache";
import { loadSettings, saveSettings } from "@/lib/settings/store";
import {
  SettingsSchema,
  type HarnessId,
  type Settings,
} from "@/lib/settings/schema";
import { getHarness } from "@/lib/harnesses";
import type { ModelInfo, ProbeResult } from "@/lib/harnesses/types";

export interface GetSettingsResult {
  ok: boolean;
  settings?: Settings;
  error?: string;
}

export async function getSettingsAction(): Promise<GetSettingsResult> {
  try {
    return { ok: true, settings: await loadSettings() };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export interface SaveSettingsResult {
  ok: boolean;
  error?: string;
}

export async function saveSettingsAction(
  next: Settings,
): Promise<SaveSettingsResult> {
  try {
    const parsed = SettingsSchema.safeParse(next);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      };
    }
    await saveSettings(parsed.data);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export type ListModelsResult =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; error: string };

export async function listModelsAction(
  id: HarnessId,
): Promise<ListModelsResult> {
  try {
    const models = await getHarness(id).listModels();
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export type ProbeResultPayload = ProbeResult;

export async function probeHarnessAction(
  id: HarnessId,
): Promise<ProbeResultPayload> {
  try {
    return await getHarness(id).probe();
  } catch (err) {
    return { ok: false, available: false, detail: describe(err) };
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
