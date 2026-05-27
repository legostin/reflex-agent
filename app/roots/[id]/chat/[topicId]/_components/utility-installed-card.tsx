"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes, Sparkles } from "lucide-react";

interface Props {
  utility: {
    id: string;
    name: string;
    scope: "global" | "project";
    version: string;
  };
  rootId?: string;
}

export function UtilityInstalledCard({ utility, rootId }: Props) {
  const t = useTranslations("roots");
  const qs =
    utility.scope === "project" && rootId
      ? `?rootId=${encodeURIComponent(rootId)}`
      : "";
  const href = `/utilities/${utility.scope}/${utility.id}${qs}`;
  return (
    <Link
      href={href}
      className="my-2 block rounded-lg border-2 p-[2px] reflex-gradient hover:shadow-md transition-shadow"
    >
      <div className="rounded-md bg-background/95 backdrop-blur p-3 flex items-center gap-3">
        <div className="reflex-gradient h-9 w-9 rounded-md flex items-center justify-center text-white shrink-0">
          <Boxes className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>{t("utilityCard.installed")}</span>
            <span className="font-mono normal-case tracking-normal">
              {utility.scope}
            </span>
          </div>
          <div className="text-sm font-medium truncate">{utility.name}</div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {utility.id} · v{utility.version}
          </div>
        </div>
      </div>
    </Link>
  );
}
