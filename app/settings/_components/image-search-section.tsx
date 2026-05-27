"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasApiKeyAction } from "@/lib/server/youtube-actions";
import {
  braveKeyStatusAction,
  saveImageProviderKeyAction,
} from "@/lib/server/image-key-actions";

/**
 * API keys for web image search providers — Unsplash (primary) and
 * Pexels (fallback). Codex `$imagegen` and Gemini Nano Banana live in
 * their own sections (Codex auth is shared with chat; Gemini is in the
 * Gemini section).
 */
export function ImageSearchSection() {
  const t = useTranslations("settings");
  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="h-4 w-4" />
          <span>{t("imageSearch.headerTitle")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t.rich("imageSearch.description", {
            api: (chunks) => <code className="font-mono">{chunks}</code>,
            dir: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </p>
        <ProviderKey
          provider="unsplash"
          label="Unsplash"
          docsHref="https://unsplash.com/developers"
          hint={t("imageSearch.unsplash.hint")}
        />
        <ProviderKey
          provider="pexels"
          label="Pexels"
          docsHref="https://pexels.com/api/"
          hint={t("imageSearch.pexels.hint")}
        />
        <ProviderKey
          provider="brave"
          label={t("imageSearch.brave.label")}
          docsHref="https://api-dashboard.search.brave.com/app/keys"
          hint={t("imageSearch.brave.hint")}
        />
      </CardContent>
    </Card>
  );
}

function ProviderKey({
  provider,
  label,
  docsHref,
  hint,
}: {
  provider: "unsplash" | "pexels" | "brave";
  label: string;
  docsHref: string;
  hint: string;
}) {
  const t = useTranslations("settings");
  const [hasKey, setHasKey] = useState(false);
  const [viaMcp, setViaMcp] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    void (async () => {
      const r = await hasApiKeyAction(provider);
      setHasKey(r.present);
      if (provider === "brave" && !r.present) {
        const status = await braveKeyStatusAction();
        setViaMcp(status.viaMcp);
      }
    })();
  }, [provider]);

  const onSave = () => {
    if (!draftKey.trim()) {
      toast.error(t("imageSearch.enterKeyError"));
      return;
    }
    startSaving(async () => {
      const r = await saveImageProviderKeyAction(provider, draftKey.trim());
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("imageSearch.keySavedToast", { label }));
      setDraftKey("");
      setHasKey(true);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {hasKey ? (
          <Badge variant="secondary" className="gap-1">
            <Check className="h-3 w-3" /> {t("imageSearch.keySaved")}
          </Badge>
        ) : viaMcp ? (
          <Badge variant="secondary" className="gap-1">
            <Check className="h-3 w-3" /> {t("imageSearch.viaMcp")}
          </Badge>
        ) : (
          <Badge variant="outline">{t("imageSearch.notConfigured")}</Badge>
        )}
        <a
          href={docsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
        >
          docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <div className="flex gap-2">
        <Label className="sr-only" htmlFor={`${provider}-key`}>
          <KeyRound className="h-3 w-3" /> {label} key
        </Label>
        <Input
          id={`${provider}-key`}
          type="password"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder={hasKey ? "••••" : t("imageSearch.keyPlaceholder", { label })}
          className="font-mono text-sm flex-1 h-8"
          disabled={saving}
        />
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={saving || !draftKey.trim()}
          className="h-8 gap-1"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
          {t("imageSearch.saveButton")}
        </Button>
      </div>
    </div>
  );
}
