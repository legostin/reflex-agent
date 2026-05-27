"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasApiKeyAction,
  listGeminiModelsAction,
  saveGeminiKeyAction,
  saveGeminiModelChoiceAction,
} from "@/lib/server/youtube-actions";

interface ModelOption {
  id: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/**
 * Manage the Gemini API key + default models. The model list is fetched
 * live from `models.list` because Google rolls model versions silently —
 * hardcoded names go 404 after a while.
 */
export function GeminiSection() {
  const t = useTranslations("settings");
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [draftKey, setDraftKey] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [currentVideoModel, setCurrentVideoModel] = useState("");
  const [loadingModels, startLoadModels] = useTransition();
  const [savingKey, startSaveKey] = useTransition();
  const [savingChoice, startSaveChoice] = useTransition();

  const refreshKey = async () => {
    const r = await hasApiKeyAction("gemini");
    setHasKey(r.present);
  };

  const refreshModels = (force = false) => {
    startLoadModels(async () => {
      const r = await listGeminiModelsAction(force);
      if (!r.ok) {
        if (!hasKey) {
          // Common case before a key is saved — silent.
          return;
        }
        toast.error(r.error);
        return;
      }
      setModels(r.models);
      setCurrentModel(r.currentModel);
      setCurrentVideoModel(r.currentVideoModel);
    });
  };

  useEffect(() => {
    void (async () => {
      await refreshKey();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasKey) refreshModels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  const saveKey = () => {
    if (!draftKey.trim()) {
      toast.error(t("gemini.enterKeyError"));
      return;
    }
    startSaveKey(async () => {
      const r = await saveGeminiKeyAction(draftKey.trim());
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("gemini.keySavedToast"));
      setDraftKey("");
      setHasKey(true);
      refreshModels(true);
    });
  };

  const saveModelChoice = (
    field: "model" | "videoModel",
    value: string,
  ) => {
    startSaveChoice(async () => {
      const r = await saveGeminiModelChoiceAction({
        [field]: value || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("gemini.savedToast"));
      if (field === "model") setCurrentModel(value);
      else setCurrentVideoModel(value);
    });
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          <span>Gemini API</span>
          {hasKey ? (
            <Badge variant="secondary" className="gap-1">
              <Check className="h-3 w-3" /> {t("gemini.keySaved")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("gemini.notConfigured")}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t.rich("gemini.description", {
            strong: (chunks) => <strong>{chunks}</strong>,
            model: <code className="font-mono">gemini-2.5-flash-image</code>,
            path: <code className="font-mono">~/.reflex/api-keys/gemini.json</code>,
            link: (chunks) => (
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-violet-700 hover:underline"
              >
                {chunks}
                <ExternalLink className="h-3 w-3" />
              </a>
            ),
          })}
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <KeyRound className="h-3 w-3" />
            {hasKey ? t("gemini.replaceKey") : t("gemini.apiKeyLabel")}
          </Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={hasKey ? "••••" : "AIza…"}
              className="font-mono text-sm flex-1 h-8"
              disabled={savingKey}
            />
            <Button
              type="button"
              size="sm"
              onClick={saveKey}
              disabled={savingKey || !draftKey.trim()}
              className="h-8 gap-1"
            >
              {savingKey ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {t("gemini.saveButton")}
            </Button>
          </div>
        </div>

        {hasKey && (
          <div className="space-y-3 pt-1 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t.rich("gemini.modelsFromBeta", {
                  path: <code className="font-mono">v1beta/models</code>,
                  count: models.length > 0 ? `(${models.length})` : "",
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => refreshModels(true)}
                disabled={loadingModels}
                className="h-7 text-xs gap-1"
              >
                {loadingModels ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {t("gemini.refreshButton")}
              </Button>
            </div>

            <ModelPicker
              label={t("gemini.defaultModelLabel")}
              hint={t("gemini.defaultModelHint")}
              value={currentModel}
              models={models}
              disabled={savingChoice || loadingModels}
              onChange={(v) => saveModelChoice("model", v)}
            />

            <ModelPicker
              label={t("gemini.youtubeModelLabel")}
              hint={t("gemini.youtubeModelHint")}
              value={currentVideoModel}
              models={models}
              disabled={savingChoice || loadingModels}
              onChange={(v) => saveModelChoice("videoModel", v)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModelPicker({
  label,
  hint,
  value,
  models,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  models: ModelOption[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // Make sure the currently-selected id is always in the list (even if it
  // didn't come back from models.list — e.g. user typed it manually before).
  const ids = new Set(models.map((m) => m.id));
  const list: ModelOption[] = ids.has(value)
    ? models
    : value
      ? [{ id: value, displayName: `${value} (saved)` }, ...models]
      : models;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue placeholder="(default)" />
        </SelectTrigger>
        <SelectContent>
          {list.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-xs">{m.id}</span>
                {m.displayName && m.displayName !== m.id && (
                  <span className="text-[10px] text-muted-foreground">
                    {m.displayName}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
