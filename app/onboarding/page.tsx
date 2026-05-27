import { redirect } from "next/navigation";
import { loadSettings } from "@/lib/settings/store";
import { listTemplatesAction } from "@/lib/server/onboarding-actions";
import { OnboardingWizard } from "./_components/wizard";

/**
 * First-run wizard. Server-component gate: if the user already finished
 * onboarding once, send them to the home page. Otherwise render the
 * client wizard with pre-fetched template metadata.
 *
 * A manual re-run is possible by visiting `/onboarding?force=1` — useful
 * if the user wants to add more Spaces from templates after the fact.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ force?: string }>;
}) {
  const { force } = await searchParams;
  const settings = await loadSettings();
  if (settings.onboardedAt && !force) {
    redirect("/");
  }
  const templates = await listTemplatesAction();
  // Reasonable defaults: detect timezone from server is unreliable; let
  // the wizard fill it on the client via Intl.DateTimeFormat().
  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50 to-emerald-50 dark:from-violet-950/40 dark:to-emerald-950/40">
      <OnboardingWizard
        templates={templates}
        initialLanguage={settings.language}
        initialName={settings.userName}
      />
    </main>
  );
}
