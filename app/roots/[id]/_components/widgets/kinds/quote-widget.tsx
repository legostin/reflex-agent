"use client";

import { useTranslations } from "next-intl";
import { Quote } from "lucide-react";
import type { QuoteData } from "@/lib/server/widgets/types";

export function QuoteWidget({
  data,
}: {
  rootId: string;
  data: QuoteData;
  readonly?: boolean;
  onPatch?: (next: QuoteData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  if (!data?.text) {
    return <p className="text-xs text-muted-foreground">{t("quoteWidget.empty")}</p>;
  }
  return (
    <figure className="relative pl-6">
      <Quote className="h-5 w-5 absolute left-0 top-0 text-violet-300" />
      <blockquote className="text-sm italic leading-relaxed">
        {data.text}
      </blockquote>
      {data.attribution && (
        <figcaption className="text-xs text-muted-foreground mt-1.5">
          — {data.attribution}
        </figcaption>
      )}
    </figure>
  );
}
