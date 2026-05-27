"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Bookmark,
  BookOpen,
  Calendar,
  Database,
  ListChecks,
  Package,
  Sparkles,
} from "lucide-react";

export interface KbWriteState {
  kind: string;
  title: string;
  relPath: string;
}

export function KbWriteCard({
  rootId,
  entry,
}: {
  rootId: string;
  entry: KbWriteState;
}) {
  const t = useTranslations("roots");
  const Icon = pickIcon(entry.kind);
  const href = `/roots/${rootId}?file=${encodeURIComponent(entry.relPath)}`;
  return (
    <Link
      href={href}
      className="my-2 block rounded-lg border-2 p-[2px] reflex-gradient hover:shadow-md transition-shadow"
    >
      <div className="rounded-md bg-background/95 backdrop-blur p-3 flex items-center gap-3">
        <div className="reflex-gradient h-9 w-9 rounded-md flex items-center justify-center text-white shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>{t("kbWriteCard.writtenToKb")}</span>
            <span className="font-mono normal-case tracking-normal">
              {entry.kind}
            </span>
          </div>
          <div className="text-sm font-medium truncate">{entry.title}</div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {entry.relPath}
          </div>
        </div>
        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

function pickIcon(kind: string) {
  const lower = kind.toLowerCase();
  if (lower === "task" || lower === "tasks") return ListChecks;
  if (lower === "meeting" || lower === "meetings") return Calendar;
  if (lower === "product" || lower === "products") return Package;
  if (lower === "fact" || lower === "facts") return Bookmark;
  return Database;
}
