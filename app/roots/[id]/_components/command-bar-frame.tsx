"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

/**
 * Visual shell used for every "ask Reflex" input across the app — project
 * page, chat, home page. Owns the animated gradient ring, the glass card,
 * and the tiny labeled header. Callers slot in their own form via
 * `children`; `headerRight` is an optional adornment (Space picker on
 * the home page, focus-file chip on the project page if we ever want one).
 */
export function CommandBarFrame({
  label,
  headerRight,
  children,
}: {
  label?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("roots");
  const resolvedLabel = label ?? t("commandBarFrame.label");
  return (
    <div className="border-t bg-background">
      <div className="mx-auto max-w-3xl px-6 py-5">
        <div className="reflex-gradient rounded-2xl p-[2px] shadow-[0_8px_40px_-12px_oklch(0.55_0.2_290/0.45)]">
          <div className="rounded-[14px] bg-background/85 backdrop-blur-xl px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="reflex-gradient inline-flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {resolvedLabel}
              </span>
              {headerRight && (
                <span className="ml-auto flex items-center gap-1">
                  {headerRight}
                </span>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
