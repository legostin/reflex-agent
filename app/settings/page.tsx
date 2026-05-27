import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { loadSettings } from "@/lib/settings/store";
import { listHarnesses } from "@/lib/harnesses";
import { SettingsForm } from "./_components/settings-form";

export default async function SettingsPage() {
  const settings = await loadSettings();
  const harnesses = listHarnesses().map((h) => ({
    id: h.id,
    label: h.label,
    supports: [...h.supports],
  }));
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header className="mb-8">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Roots
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Pick which harness runs each kind of task and which model it uses.
          Agentic work (analyze / chat) goes to Claude Code or Codex; RAG and
          embedding work goes to Ollama by default.
        </p>
      </header>
      <Separator className="mb-6" />
      <SettingsForm initialSettings={settings} harnesses={harnesses} />
    </main>
  );
}
