"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMAGE_FORMATS,
  LANGUAGE_PRESETS,
  TASK_IDS,
  TASK_LABELS,
  type HarnessId,
  type ImageFormat,
  type Settings,
  type TaskId,
} from "@/lib/settings";
import { PromptTemplatesEditor } from "./prompt-templates-editor";
import { McpServersSection } from "./mcp-servers-section";
import { OAuthProvidersSection } from "./oauth-providers-section";
import { GeminiSection } from "./gemini-section";
import { ImageSearchSection } from "./image-search-section";
import { MapServicesSection } from "./map-services-section";
import { NgrokSection } from "./ngrok-section";
import type { ModelInfo, ProbeResult } from "@/lib/harnesses/types";
import {
  listModelsAction,
  probeHarnessAction,
  saveSettingsAction,
} from "@/lib/server/settings-actions";

interface Props {
  initialSettings: Settings;
  harnesses: Array<{
    id: HarnessId;
    label: string;
    supports: TaskId[];
  }>;
}

export function SettingsForm({ initialSettings, harnesses }: Props) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [models, setModels] = useState<Record<HarnessId, ModelInfo[] | null>>({
    "claude-code": null,
    codex: null,
    ollama: null,
  });
  const [modelErrors, setModelErrors] = useState<
    Record<HarnessId, string | null>
  >({
    "claude-code": null,
    codex: null,
    ollama: null,
  });
  const [loading, setLoading] = useState<Record<HarnessId, boolean>>({
    "claude-code": false,
    codex: false,
    ollama: false,
  });
  const [probes, setProbes] = useState<Record<HarnessId, ProbeResult | null>>({
    "claude-code": null,
    codex: null,
    ollama: null,
  });
  const [saving, startSaving] = useTransition();

  const refreshModels = useCallback(async (id: HarnessId) => {
    setLoading((l) => ({ ...l, [id]: true }));
    setModelErrors((e) => ({ ...e, [id]: null }));
    const res = await listModelsAction(id);
    setLoading((l) => ({ ...l, [id]: false }));
    if (res.ok) {
      setModels((m) => ({ ...m, [id]: res.models }));
    } else {
      setModelErrors((e) => ({ ...e, [id]: res.error }));
      setModels((m) => ({ ...m, [id]: [] }));
    }
  }, []);

  const refreshProbe = useCallback(async (id: HarnessId) => {
    const r = await probeHarnessAction(id);
    setProbes((p) => ({ ...p, [id]: r }));
  }, []);

  useEffect(() => {
    // Probe + load each harness's models on mount so the dropdowns start
    // populated with the live picture.
    harnesses.forEach((h) => {
      void refreshProbe(h.id);
      void refreshModels(h.id);
    });
  }, [harnesses, refreshProbe, refreshModels]);

  const setOllamaUrl = (url: string) => {
    setSettings((s) => ({
      ...s,
      harnesses: {
        ...s.harnesses,
        ollama: { ...s.harnesses.ollama, baseUrl: url },
      },
    }));
  };

  const toggleEnabled = (id: HarnessId, enabled: boolean) => {
    setSettings((s) => ({
      ...s,
      harnesses: {
        ...s.harnesses,
        [id]: { ...s.harnesses[id], enabled },
      },
    }));
  };

  const updateAssignment = (
    task: TaskId,
    patch: Partial<{
      harness: HarnessId;
      model: string;
      allowedTools: string[];
    }>,
  ) => {
    setSettings((s) => ({
      ...s,
      assignments: {
        ...s.assignments,
        [task]: { ...s.assignments[task], ...patch },
      },
    }));
  };

  const save = () => {
    startSaving(async () => {
      const res = await saveSettingsAction(settings);
      if (!res.ok) toast.error(res.error ?? "Save failed");
      else toast.success("Settings saved");
    });
  };

  const setLanguage = (v: string) => {
    setSettings((s) => ({ ...s, language: v }));
  };

  const updateImageProcessing = (
    patch: Partial<Settings["imageProcessing"]>,
  ) => {
    setSettings((s) => ({
      ...s,
      imageProcessing: { ...s.imageProcessing, ...patch },
    }));
  };

  const isPreset = (LANGUAGE_PRESETS as readonly string[]).includes(
    settings.language,
  );

  const isAdvanced = settings.uiMode === "advanced";
  const toggleAdvanced = () => {
    const next: Settings = {
      ...settings,
      uiMode: isAdvanced ? "simple" : "advanced",
    };
    setSettings(next);
    // Persist immediately so the toggle survives a navigation away.
    void saveSettingsAction(next);
  };

  return (
    <div className="space-y-8">
      <Card className="border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20">
        <CardContent className="pt-5 pb-5 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium">
              {isAdvanced ? "Расширенный режим" : "Простой режим"}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isAdvanced
                ? "Видны все секции — модели, MCP-серверы, prompt-шаблоны, инструменты."
                : "Видны только основные настройки. Включи расширенный, чтобы поменять модели, подключения и промпты."}
            </p>
          </div>
          <Button
            type="button"
            variant={isAdvanced ? "outline" : "default"}
            size="sm"
            onClick={toggleAdvanced}
          >
            {isAdvanced ? "Простой режим" : "Расширенный режим"}
          </Button>
        </CardContent>
      </Card>
      <section>
        <h2 className="text-lg font-semibold mb-3">Output language</h2>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-3">
              The agent injects this into every system prompt and writes all
              Markdown artifacts in this language. Code, paths, and quoted
              source stay verbatim.
            </p>
            <div className="flex items-center gap-3 max-w-xl">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Preset</Label>
                <Select
                  value={isPreset ? settings.language : "__custom__"}
                  onValueChange={(v) => {
                    if (v === "__custom__") {
                      setLanguage(isPreset ? "" : settings.language);
                    } else {
                      setLanguage(v);
                    }
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">custom…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isPreset && (
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">
                    Custom
                  </Label>
                  <Input
                    value={settings.language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="e.g. português, latviešu"
                    className="mt-1"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Обработка изображений</h2>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm">
                  Reflex автоматически ресайзит и перекодирует прикреплённые
                  изображения перед сохранением в{" "}
                  <code className="font-mono text-xs">.reflex/attachments/</code>.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Сокращает токены модели и место на диске. Векторы (SVG) и
                  анимированные GIF/WebP остаются как есть.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="img-enabled" className="text-xs">
                  включено
                </Label>
                <Switch
                  id="img-enabled"
                  checked={settings.imageProcessing.enabled}
                  onCheckedChange={(v) =>
                    updateImageProcessing({ enabled: v })
                  }
                />
              </div>
            </div>
            <div
              className={
                settings.imageProcessing.enabled
                  ? "space-y-4"
                  : "space-y-4 opacity-50 pointer-events-none"
              }
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">
                    Макс. сторона
                  </Label>
                  <span className="font-mono text-xs">
                    {settings.imageProcessing.maxDimension}px
                  </span>
                </div>
                <Slider
                  min={256}
                  max={8192}
                  step={64}
                  value={[settings.imageProcessing.maxDimension]}
                  onValueChange={(v) =>
                    updateImageProcessing({ maxDimension: v[0] ?? 2000 })
                  }
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>256</span>
                  <span>2048</span>
                  <span>4096</span>
                  <span>8192</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">
                    Качество (JPEG / WebP)
                  </Label>
                  <span className="font-mono text-xs">
                    {settings.imageProcessing.quality}
                  </span>
                </div>
                <Slider
                  min={40}
                  max={100}
                  step={1}
                  value={[settings.imageProcessing.quality]}
                  onValueChange={(v) =>
                    updateImageProcessing({ quality: v[0] ?? 85 })
                  }
                />
              </div>
              <div className="max-w-xs">
                <Label className="text-xs text-muted-foreground">Формат</Label>
                <Select
                  value={settings.imageProcessing.format}
                  onValueChange={(v) =>
                    updateImageProcessing({ format: v as ImageFormat })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        <span className="font-mono">{f}</span>
                        <span className="ml-2 text-muted-foreground text-xs">
                          {f === "auto"
                            ? "JPEG, PNG для прозрачных"
                            : f === "jpeg"
                              ? "всё в JPEG (альфа → белый фон)"
                              : f === "webp"
                                ? "всё в WebP"
                                : "оставить исходный контейнер"}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {isAdvanced && (
      <section>
        <h2 className="text-lg font-semibold mb-3">Harnesses</h2>
        <div className="grid gap-4">
          {harnesses.map((h) => {
            const probe = probes[h.id];
            const enabled = settings.harnesses[h.id].enabled;
            return (
              <Card key={h.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {h.label}
                        <ProbeBadge probe={probe} />
                      </CardTitle>
                      <CardDescription>
                        {probe ? probe.detail : "checking…"}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void refreshProbe(h.id);
                          void refreshModels(h.id);
                        }}
                        disabled={loading[h.id]}
                      >
                        <RefreshCw
                          className={`mr-1 h-4 w-4 ${
                            loading[h.id] ? "animate-spin" : ""
                          }`}
                        />
                        Refresh
                      </Button>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`enable-${h.id}`} className="text-xs">
                          enabled
                        </Label>
                        <Switch
                          id={`enable-${h.id}`}
                          checked={enabled}
                          onCheckedChange={(v) => toggleEnabled(h.id, v)}
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {h.id === "ollama" && (
                    <div className="mb-3 flex items-center gap-2 max-w-md">
                      <Label
                        htmlFor="ollama-url"
                        className="text-xs w-24 shrink-0"
                      >
                        Base URL
                      </Label>
                      <Input
                        id="ollama-url"
                        value={settings.harnesses.ollama.baseUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="font-mono text-xs"
                      />
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Models loaded:{" "}
                    {loading[h.id] ? (
                      <span>
                        <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                        loading…
                      </span>
                    ) : modelErrors[h.id] ? (
                      <span className="text-destructive">
                        {modelErrors[h.id]}
                      </span>
                    ) : (
                      `${models[h.id]?.length ?? 0}`
                    )}
                    {(models[h.id]?.length ?? 0) > 0 && (
                      <span className="ml-2">
                        ({models[h.id]?.[0]?.source})
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      )}

      {isAdvanced && (
      <section>
        <h2 className="text-lg font-semibold mb-3">Task assignments</h2>
        <div className="grid gap-4">
          {TASK_IDS.map((task) => {
            const assignment = settings.assignments[task];
            const eligibleHarnesses = harnesses.filter(
              (h) =>
                h.supports.includes(task) && settings.harnesses[h.id].enabled,
            );
            const harnessModels = models[assignment.harness] ?? [];
            const modelSource = harnessModels[0]?.source;
            return (
              <Card key={task}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {TASK_LABELS[task].title}
                  </CardTitle>
                  <CardDescription>{TASK_LABELS[task].help}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1 max-w-[200px]">
                      <Label className="text-xs text-muted-foreground">
                        Harness
                      </Label>
                      <Select
                        value={assignment.harness}
                        onValueChange={(v) =>
                          updateAssignment(task, {
                            harness: v as HarnessId,
                            // Reset model when harness changes.
                            model: models[v as HarnessId]?.[0]?.id ?? "",
                          })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleHarnesses.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">
                          Model
                        </Label>
                        {modelSource && (
                          <Badge
                            variant={
                              modelSource === "live" ? "default" : "secondary"
                            }
                            className="text-[10px] uppercase"
                          >
                            {modelSource}
                          </Badge>
                        )}
                      </div>
                      {harnessModels.length > 0 ? (
                        <Select
                          value={assignment.model}
                          onValueChange={(v) =>
                            updateAssignment(task, { model: v })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="select model" />
                          </SelectTrigger>
                          <SelectContent>
                            {harnessModels.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                <span className="font-mono">{m.id}</span>
                                {m.size && (
                                  <span className="ml-2 text-muted-foreground text-xs">
                                    {m.size}
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={assignment.model}
                          onChange={(e) =>
                            updateAssignment(task, { model: e.target.value })
                          }
                          placeholder="model id"
                          className="mt-1 font-mono text-xs"
                        />
                      )}
                    </div>
                  </div>
                  {assignment.harness === "claude-code" && (
                    <ToolsPolicyEditor
                      tools={assignment.allowedTools}
                      onChange={(v) =>
                        updateAssignment(task, { allowedTools: v })
                      }
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Gemini</h2>
        <GeminiSection />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Картинки</h2>
        <ImageSearchSection />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">OAuth providers</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Reflex держит локально access/refresh-токены и сам обновляет их при
          истечении. Используй <code>$oauth:&lt;provider&gt;</code> в env/headers
          MCP-сервера — Reflex подставит свежий токен при каждом вызове.
          Redirect URI:{" "}
          <code className="font-mono">
            http://localhost:3210/api/oauth/callback
          </code>
          .
        </p>
        <OAuthProvidersSection />
      </section>

      {isAdvanced && (
      <section>
        <h2 className="text-lg font-semibold mb-3">MCP servers</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Зарегистрированные MCP-серверы доступны утилитам (через{" "}
          <code>manifest.mcpServers</code>) и чату напрямую (orchestrator
          получает их через <code>--mcp-config</code>). Config хранится в{" "}
          <code>~/.reflex/mcp/servers.json</code> с perms <code>0600</code>.
        </p>
        <McpServersSection />
      </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Сервисы маршрутов</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Какие сервисы навигации появятся в попапе «Маршрут в…» на каждой
          точке map-виджета. Reflex генерирует deep-link из координат — без
          посредников, без аккаунтов.
        </p>
        <MapServicesSection
          settings={settings}
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Публичные ссылки (ngrok)</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Сделать утилиту, KB-файл или дашборд доступным из интернета через
          ngrok-туннель. Каждая ссылка опционально защищена паролем; middleware
          закрывает все остальные пути на ngrok-хосте.
        </p>
        <NgrokSection
          settings={settings}
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
        />
      </section>

      {isAdvanced && (
      <section>
        <h2 className="text-lg font-semibold mb-3">Prompt templates</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Stored on disk under <code>~/.reflex/prompts/</code>. Edit here or
          directly in any editor. Use <code>{"{{language}}"}</code>,{" "}
          <code>{"{{scope}}"}</code>, etc. — variable list is shown per
          template.
        </p>
        <PromptTemplatesEditor />
      </section>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> Save settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

const CLAUDE_TOOL_SUGGESTIONS = [
  "Read",
  "Write",
  "Edit",
  "LS",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Task",
  "NotebookEdit",
];

function ToolsPolicyEditor({
  tools,
  onChange,
}: {
  tools: string[];
  onChange: (next: string[]) => void;
}) {
  const remove = (t: string) => onChange(tools.filter((x) => x !== t));
  const add = (t: string) => {
    const v = t.trim();
    if (!v) return;
    if (tools.includes(v)) return;
    onChange([...tools, v]);
  };
  const [draft, setDraft] = useState("");
  const inactive = CLAUDE_TOOL_SUGGESTIONS.filter((t) => !tools.includes(t));
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground">
          Allowed tools (claude-code)
        </Label>
        <span className="text-[10px] text-muted-foreground">
          без них агент попросит разрешение и зависнет в headless-режиме
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tools.length === 0 && (
          <span className="text-[11px] italic text-muted-foreground">
            используются дефолты harness'а
          </span>
        )}
        {tools.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 font-mono">
            {t}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => remove(t)}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      {inactive.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {inactive.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="text-[11px] font-mono rounded px-1.5 py-0.5 border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="custom tool name…"
          className="h-7 text-xs font-mono"
        />
        <Button type="submit" size="sm" variant="ghost" className="h-7">
          +
        </Button>
      </form>
    </div>
  );
}

function ProbeBadge({ probe }: { probe: ProbeResult | null }) {
  if (!probe) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> checking
      </Badge>
    );
  }
  if (probe.available) {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> available
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" /> unavailable
    </Badge>
  );
}
