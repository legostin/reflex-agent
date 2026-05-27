"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cloud,
  HardDrive,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  detectEnginesAction,
  runOnboardingAction,
} from "@/lib/server/onboarding-actions";

interface TemplateMeta {
  id: string;
  label: string;
  emoji: string;
  description: string;
}

interface Props {
  templates: TemplateMeta[];
  initialLanguage: string;
  initialName: string;
}

type Step = 0 | 1 | 2 | 3;

interface EngineState {
  loading: boolean;
  claudeAvailable: boolean;
  claudeVersion?: string;
  codexAvailable: boolean;
  codexVersion?: string;
  ollamaAvailable: boolean;
  ollamaModels?: number;
}

/**
 * Four-step wizard run on first launch. Each step is a self-contained
 * card; navigation is forward-only by default (Next button) but the user
 * can step back to fix a typo. Atomic finalize at step 4 sets
 * `settings.onboardedAt`, which the route guard reads to skip future
 * runs.
 */
export function OnboardingWizard({
  templates,
  initialLanguage,
  initialName,
}: Props) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState(initialName);
  const [language, setLanguage] = useState(initialLanguage || "russian");
  const [timezone, setTimezone] = useState("");
  const [engine, setEngine] = useState<"claude" | "codex" | "ollama">("claude");
  const [engineState, setEngineState] = useState<EngineState>({
    loading: true,
    claudeAvailable: false,
    codexAvailable: false,
    ollamaAvailable: false,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, startSubmit] = useTransition();

  // Detect engines on mount + read user's local timezone.
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      /* ignore */
    }
    void (async () => {
      const r = await detectEnginesAction();
      setEngineState({
        loading: false,
        claudeAvailable: r.claudeCli.available,
        ...(r.claudeCli.version ? { claudeVersion: r.claudeCli.version } : {}),
        codexAvailable: r.codexCli.available,
        ...(r.codexCli.version ? { codexVersion: r.codexCli.version } : {}),
        ollamaAvailable: r.ollama.available,
        ...(r.ollama.modelsCount !== undefined
          ? { ollamaModels: r.ollama.modelsCount }
          : {}),
      });
      // Default engine pick: prefer whatever is actually installed,
      // Claude first, then Codex, then Ollama. If nothing is available,
      // leave the default ("claude") so the user can see the install link.
      if (!r.claudeCli.available) {
        if (r.codexCli.available) setEngine("codex");
        else if (r.ollama.available) setEngine("ollama");
      }
    })();
  }, []);

  const canNext = useMemo(() => {
    if (step === 0) return name.trim().length > 0 && language.trim().length > 0;
    if (step === 1) {
      if (engine === "claude") return engineState.claudeAvailable;
      if (engine === "codex") return engineState.codexAvailable;
      return engineState.ollamaAvailable;
    }
    if (step === 2) return selected.size > 0;
    return true;
  }, [step, name, language, engine, engineState, selected]);

  const finish = () => {
    startSubmit(async () => {
      const r = await runOnboardingAction({
        userName: name.trim(),
        language: language.trim(),
        timezone: timezone.trim(),
        engine,
        templates: [...selected],
      });
      if (!r.ok) {
        toast.error(r.error ?? t("errors.generic"));
        return;
      }
      toast.success(
        t("success.created", {
          spaces: r.spacesCreated,
          widgets: r.widgetsCreated,
        }),
      );
      router.push("/");
    });
  };

  const stepTitles = [
    t("stepTitles.0"),
    t("stepTitles.1"),
    t("stepTitles.2"),
    t("stepTitles.3"),
  ];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <header className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <span className="font-medium">{t("header.welcome")}</span>
          <span className="ml-auto text-xs">
            {t("header.stepCounter", {
              current: step + 1,
              total: 4,
              title: stepTitles[step],
            })}
          </span>
        </header>
        <Progress current={step} />

        {step === 0 && (
          <Card>
            <h1 className="text-2xl font-semibold">{t("step0.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("step0.description")}
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="name">
                {t("step0.nameLabel")}
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder={t("step0.namePlaceholder")}
                className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="lang">
                {t("step0.languageLabel")}
              </label>
              <select
                id="lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="russian">{t("step0.languageRu")}</option>
                <option value="english">{t("step0.languageEn")}</option>
                <option value="español">{t("step0.languageEs")}</option>
                <option value="deutsch">{t("step0.languageDe")}</option>
                <option value="français">{t("step0.languageFr")}</option>
              </select>
            </div>
            {timezone && (
              <p className="text-[11px] text-muted-foreground">
                {t("step0.timezoneDetected")} <code className="font-mono">{timezone}</code>
              </p>
            )}
          </Card>
        )}

        {step === 1 && (
          <Card>
            <h1 className="text-2xl font-semibold">{t("step1.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("step1.description")}
            </p>
            {engineState.loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("step1.checking")}
              </p>
            ) : (
              <div className="grid gap-2">
                <EngineOption
                  selected={engine === "claude"}
                  onSelect={() => setEngine("claude")}
                  icon={<Cloud className="h-5 w-5" />}
                  title={t("step1.claudeTitle")}
                  description={t("step1.claudeDescription")}
                  installLinkLabel={t("step1.installLink")}
                  status={
                    engineState.claudeAvailable
                      ? { ok: true, hint: engineState.claudeVersion ?? t("step1.claudeReady") }
                      : {
                          ok: false,
                          hint: t("step1.claudeMissing"),
                          link: "https://docs.anthropic.com/claude/docs/claude-code",
                        }
                  }
                />
                <EngineOption
                  selected={engine === "codex"}
                  onSelect={() => setEngine("codex")}
                  icon={<Zap className="h-5 w-5" />}
                  title={t("step1.codexTitle")}
                  description={t("step1.codexDescription")}
                  installLinkLabel={t("step1.installLink")}
                  status={
                    engineState.codexAvailable
                      ? { ok: true, hint: engineState.codexVersion ?? t("step1.codexReady") }
                      : {
                          ok: false,
                          hint: t("step1.codexMissing"),
                          link: "https://github.com/openai/codex",
                        }
                  }
                />
                <EngineOption
                  selected={engine === "ollama"}
                  onSelect={() => setEngine("ollama")}
                  icon={<HardDrive className="h-5 w-5" />}
                  title={t("step1.ollamaTitle")}
                  description={t("step1.ollamaDescription")}
                  installLinkLabel={t("step1.installLink")}
                  status={
                    engineState.ollamaAvailable
                      ? {
                          ok: true,
                          hint: t("step1.ollamaModels", {
                            count: engineState.ollamaModels ?? "?",
                          }),
                        }
                      : {
                          ok: false,
                          hint: t("step1.ollamaMissing"),
                          link: "https://ollama.com/download",
                        }
                  }
                />
              </div>
            )}
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h1 className="text-2xl font-semibold">{t("step2.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("step2.description")}
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((tpl) => {
                const on = selected.has(tpl.id);
                return (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(selected);
                        if (next.has(tpl.id)) next.delete(tpl.id);
                        else next.add(tpl.id);
                        setSelected(next);
                      }}
                      className={
                        "w-full text-left rounded-lg border p-3 transition " +
                        (on
                          ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40"
                          : "hover:bg-accent")
                      }
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-2xl leading-none">{tpl.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium flex items-center gap-1">
                            {tpl.label}
                            {on && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                            {tpl.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              {t("step2.folderHint")}
            </p>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <h1 className="text-2xl font-semibold">{t("step3.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("step3.description")}
            </p>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("step3.profileLabel")} <strong>{name}</strong> · {language} · {timezone || t("step3.empty")}
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("step3.engineLabel")}{" "}
                <strong>
                  {engine === "claude"
                    ? t("step3.engineClaude")
                    : engine === "codex"
                      ? t("step3.engineCodex")
                      : t("step3.engineOllama")}
                </strong>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("step3.spacesLabel")} {[...selected]
                  .map((id) => templates.find((tpl) => tpl.id === id)?.label)
                  .filter(Boolean)
                  .join(" · ") || t("step3.empty")}
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("step3.footer")}
            </p>
          </Card>
        )}

        <div className="flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("nav.back")}
            </button>
          )}
          <div className="ml-auto" />
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!canNext}
              className="inline-flex items-center gap-1 rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {t("nav.next")}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("nav.start")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      {children}
    </section>
  );
}

function Progress({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={
            "h-1 flex-1 rounded-full " +
            (i <= current ? "bg-violet-600" : "bg-muted")
          }
        />
      ))}
    </div>
  );
}

function EngineOption({
  selected,
  onSelect,
  icon,
  title,
  description,
  status,
  installLinkLabel,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  status: { ok: boolean; hint: string; link?: string };
  installLinkLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "w-full text-left rounded-lg border p-3 transition flex items-start gap-3 " +
        (selected
          ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40"
          : "hover:bg-accent")
      }
    >
      <div className="mt-0.5 text-violet-600">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-medium flex items-center gap-2">
          {title}
          {selected && <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" />}
        </div>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">
          {description}
        </p>
        <div
          className={
            "mt-1.5 inline-flex items-center gap-1 text-[11px] " +
            (status.ok ? "text-emerald-700" : "text-amber-700")
          }
        >
          {status.ok ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          <span>{status.hint}</span>
          {status.link && (
            <a
              href={status.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline ml-1"
            >
              {installLinkLabel}
            </a>
          )}
        </div>
      </div>
    </button>
  );
}
