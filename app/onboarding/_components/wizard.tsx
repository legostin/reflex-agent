"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState(initialName);
  const [language, setLanguage] = useState(initialLanguage || "русский");
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
        toast.error(r.error ?? "Что-то пошло не так");
        return;
      }
      toast.success(
        `Создано: ${r.spacesCreated} пространств, ${r.widgetsCreated} карточек.`,
      );
      router.push("/");
    });
  };

  const stepTitles = [
    "Здравствуй",
    "AI-движок",
    "Что важно для тебя",
    "Готово",
  ];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <header className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-violet-600" />
          <span className="font-medium">Добро пожаловать в Reflex</span>
          <span className="ml-auto text-xs">
            Шаг {step + 1} из 4 · {stepTitles[step]}
          </span>
        </header>
        <Progress current={step} />

        {step === 0 && (
          <Card>
            <h1 className="text-2xl font-semibold">Как тебя зовут?</h1>
            <p className="text-sm text-muted-foreground">
              Reflex будет звать тебя по имени — на дашборде, в утренних
              приветствиях, в напоминаниях.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="name">
                Имя
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="Например, Люда"
                className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="lang">
                Язык общения
              </label>
              <select
                id="lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="русский">Русский</option>
                <option value="english">English</option>
                <option value="español">Español</option>
                <option value="deutsch">Deutsch</option>
                <option value="français">Français</option>
              </select>
            </div>
            {timezone && (
              <p className="text-[11px] text-muted-foreground">
                Часовой пояс определён: <code className="font-mono">{timezone}</code>
              </p>
            )}
          </Card>
        )}

        {step === 1 && (
          <Card>
            <h1 className="text-2xl font-semibold">На каком движке работаем</h1>
            <p className="text-sm text-muted-foreground">
              Reflex использует одну из двух нейросетей. Выбери ту, что тебе
              ближе — потом можно поменять в настройках.
            </p>
            {engineState.loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Проверяю что у тебя установлено…
              </p>
            ) : (
              <div className="grid gap-2">
                <EngineOption
                  selected={engine === "claude"}
                  onSelect={() => setEngine("claude")}
                  icon={<Cloud className="h-5 w-5" />}
                  title="Claude (умный)"
                  description="Лучше всех понимает контекст и пишет тексты. Работает через Claude Code CLI."
                  status={
                    engineState.claudeAvailable
                      ? { ok: true, hint: engineState.claudeVersion ?? "готов" }
                      : {
                          ok: false,
                          hint: "Не найден — установи Claude Code CLI и авторизуйся",
                          link: "https://docs.anthropic.com/claude/docs/claude-code",
                        }
                  }
                />
                <EngineOption
                  selected={engine === "codex"}
                  onSelect={() => setEngine("codex")}
                  icon={<Zap className="h-5 w-5" />}
                  title="Codex (быстрый GPT)"
                  description="OpenAI Codex CLI с GPT-5. Быстрее Claude, требует подписку OpenAI."
                  status={
                    engineState.codexAvailable
                      ? { ok: true, hint: engineState.codexVersion ?? "готов" }
                      : {
                          ok: false,
                          hint: "Не найден — установи Codex CLI и логин через OpenAI",
                          link: "https://github.com/openai/codex",
                        }
                  }
                />
                <EngineOption
                  selected={engine === "ollama"}
                  onSelect={() => setEngine("ollama")}
                  icon={<HardDrive className="h-5 w-5" />}
                  title="Ollama (локальная, бесплатно)"
                  description="Полностью локальная модель. Бесплатно, приватно, медленнее."
                  status={
                    engineState.ollamaAvailable
                      ? {
                          ok: true,
                          hint: `${engineState.ollamaModels ?? "?"} моделей доступно`,
                        }
                      : {
                          ok: false,
                          hint: "Не отвечает на localhost:11434 — запусти Ollama",
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
            <h1 className="text-2xl font-semibold">Что важно для тебя сейчас</h1>
            <p className="text-sm text-muted-foreground">
              Выбери области жизни, с которыми Reflex поможет. На каждую он
              создаст отдельное пространство с готовыми карточками и
              разговорами. Можно добавить ещё в любой момент.
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t) => {
                const on = selected.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(selected);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
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
                        <span className="text-2xl leading-none">{t.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium flex items-center gap-1">
                            {t.label}
                            {on && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                            {t.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Пространства создаются в папке <code className="font-mono">~/Reflex/</code>{" "}
              — можно перенести позже.
            </p>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <h1 className="text-2xl font-semibold">Готовы начать?</h1>
            <p className="text-sm text-muted-foreground">
              Reflex создаст для тебя:
            </p>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Профиль: <strong>{name}</strong> · {language} · {timezone || "—"}
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Движок:{" "}
                <strong>
                  {engine === "claude"
                    ? "Claude"
                    : engine === "codex"
                      ? "Codex (GPT-5)"
                      : "Ollama"}
                </strong>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Пространства: {[...selected]
                  .map((id) => templates.find((t) => t.id === id)?.label)
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              После клика «Начать» откроется главный экран. Все настройки можно
              поменять позже.
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
              Назад
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
              Дальше
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
              Начать
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
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  status: { ok: boolean; hint: string; link?: string };
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
              как установить →
            </a>
          )}
        </div>
      </div>
    </button>
  );
}
