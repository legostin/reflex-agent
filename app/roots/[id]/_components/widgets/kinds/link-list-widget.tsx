"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, Link as LinkIcon, Trash2 } from "lucide-react";
import type { LinkListData } from "@/lib/server/widgets/types";

type Item = LinkListData["items"][number];

/**
 * Curated bookmark list. Interactive affordance: per-row delete (× on
 * hover). Reordering deliberately not added — link curation is rarely
 * order-sensitive and the agent can resort on the next refresh.
 */
export function LinkListWidget({
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: LinkListData;
  readonly?: boolean;
  onPatch?: (next: LinkListData) => Promise<void> | void;
}) {
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

  const remove = (i: number) => {
    if (readonly) return;
    persist(items.filter((_, idx) => idx !== i));
  };

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Нет ссылок.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {items.map((it, i) => (
        <li key={i} className="group/row relative">
          <a
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/40 transition"
          >
            <LinkIcon className="h-3 w-3 mt-1 shrink-0 text-sky-600" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium hover:underline inline-flex items-center gap-1">
                {it.title}
                <ExternalLink className="h-3 w-3 opacity-50" />
              </div>
              {it.hint && (
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {it.hint}
                </p>
              )}
              <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">
                {it.url}
              </div>
            </div>
          </a>
          {!readonly && (
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={pending}
              aria-label="Удалить ссылку"
              className="absolute top-1.5 right-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
