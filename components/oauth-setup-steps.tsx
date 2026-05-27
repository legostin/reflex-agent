"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";

export interface OAuthSetupStep {
  title: string;
  body?: string;
  field?: string;
  copy?: string;
  choice?: string;
}

/**
 * Numbered walkthrough for OAuth client setup. Used both in the Settings
 * provider panel and inside the chat's McpAddCard so the user gets
 * step-by-step guidance with copy-able values next to the field names.
 */
export function OAuthSetupSteps({ steps }: { steps: OAuthSetupStep[] }) {
  const t = useTranslations("app");
  if (!steps || steps.length === 0) return null;
  return (
    <ol className="space-y-2 text-xs">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-mono text-muted-foreground shrink-0 w-5 text-right">
            {i + 1}.
          </span>
          <div className="space-y-1 flex-1 min-w-0">
            <div>{step.title}</div>
            {step.choice && (
              <div className="text-[11px]">
                <span className="text-muted-foreground">{t("oauth.copyHint")}</span>
                <span className="font-medium bg-muted/60 rounded px-1.5 py-0.5">
                  {step.choice}
                </span>
              </div>
            )}
            {step.body && (
              <p className="text-[11px] text-muted-foreground">{step.body}</p>
            )}
            {step.copy && (
              <div className="flex items-center gap-2 mt-1">
                {step.field && (
                  <span className="text-[11px] text-muted-foreground">
                    {step.field}:
                  </span>
                )}
                <code className="font-mono text-[11px] bg-muted/60 rounded px-1.5 py-0.5 break-all flex-1 min-w-0">
                  {step.copy}
                </code>
                <CopyButton value={step.copy} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("app");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-6 w-6 shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(t("oauth.copied"));
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error(t("oauth.copyFailed"));
        }
      }}
      title={t("oauth.copy")}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}
