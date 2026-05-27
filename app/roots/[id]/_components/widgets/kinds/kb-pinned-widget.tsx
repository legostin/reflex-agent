"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, X } from "lucide-react";
import type { KbPinnedData } from "@/lib/server/widgets/types";

type Item = KbPinnedData["items"][number];

/**
 * Pinned KB rel-paths. Interactive: per-row "open-pin" X removes the
 * entry — agents typically interpret this as "user lost interest in
 * this file" and won't re-pin on next refresh (the dedupe-via-memory
 * pattern works here too).
 */
export function KbPinnedWidget({
  rootId,
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: KbPinnedData;
  readonly?: boolean;
  onPatch?: (next: KbPinnedData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  const initial = data.items ?? [];
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, startSave] = useTransition();
  const prevPropsJson = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(initial);
    if (key !== prevPropsJson.current) {
      prevPropsJson.current = key;
      setItems(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const persist = (next: Item[]) => {
    setItems(next);
    if (!onPatch) return;
    startSave(async () => {
      try {
        await onPatch({ items: next });
      } catch {
        /* wrapper toasted */
      }
    });
  };

  const unpin = (i: number) => {
    if (readonly) return;
    persist(items.filter((_, idx) => idx !== i));
  };

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("kbPinnedWidget.empty")}</p>
    );
  }
  return (
    <ul className="space-y-1">
      {items.map((it, i) => {
        const encoded = it.rel.split("/").map(encodeURIComponent).join("/");
        return (
          <li key={i} className="group/row relative">
            <Link
              href={`/roots/${rootId}/kb/${encoded}`}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40 transition pr-7"
            >
              <FileText className="h-3 w-3 mt-0.5 shrink-0 text-emerald-700" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {it.title ?? it.rel}
                </div>
                {it.snippet && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-0.5">
                    {it.snippet}
                  </p>
                )}
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                  {it.rel}
                </div>
              </div>
            </Link>
            {!readonly && (
              <button
                type="button"
                onClick={() => unpin(i)}
                disabled={pending}
                aria-label={t("kbPinnedWidget.unpinAria")}
                title={t("kbPinnedWidget.unpinTitle")}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
