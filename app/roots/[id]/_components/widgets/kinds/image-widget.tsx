"use client";

import { useTranslations } from "next-intl";
import type { ImageData } from "@/lib/server/widgets/types";

export function ImageWidget({
  data,
}: {
  rootId: string;
  data: ImageData;
  readonly?: boolean;
  onPatch?: (next: ImageData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  if (!data?.url) {
    return <p className="text-xs text-muted-foreground">{t("imageWidget.empty")}</p>;
  }
  return (
    <figure className="space-y-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.url}
        alt={data.alt ?? ""}
        className="rounded-md w-full h-auto border"
        loading="lazy"
      />
      {data.caption && (
        <figcaption className="text-xs text-muted-foreground text-center">
          {data.caption}
        </figcaption>
      )}
    </figure>
  );
}
