"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ExternalLink, Newspaper, X } from "lucide-react";
import type { NewsListData } from "@/lib/server/widgets/types";

type Item = NewsListData["items"][number];

/**
 * News digest. Two interactive affordances:
 *   - "прочитано" toggle (✓ icon, hover) → sets `read: true`. Row dims.
 *   - "dismiss" (× icon, hover) → permanently removes from items.
 * Both feed back into the widget data; the agent sees `read` flags in
 * memory and can dedupe on the next refresh.
 */
export function NewsListWidget({
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: NewsListData;
  readonly?: boolean;
  onPatch?: (next: NewsListData) => Promise<void> | void;
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

  const toggleRead = (i: number) => {
    if (readonly) return;
    persist(items.map((it, idx) => (idx === i ? { ...it, read: !it.read } : it)));
  };

  const dismiss = (i: number) => {
    if (readonly) return;
    persist(items.filter((_, idx) => idx !== i));
  };

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Список новостей пустой.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li
          key={i}
          className={`group/row relative border-l-2 pl-2.5 py-0.5 transition ${
            it.read
              ? "border-muted-foreground/30 opacity-60"
              : "border-violet-200"
          }`}
        >
          <div className="flex items-start gap-1.5">
            <Newspaper
              className={`h-3 w-3 mt-1 shrink-0 ${it.read ? "text-muted-foreground" : "text-violet-600"}`}
            />
            <div className="min-w-0 flex-1 pr-12">
              {it.url ? (
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline inline-flex items-center gap-1"
                >
                  {it.title}
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              ) : (
                <span className="text-sm font-medium">{it.title}</span>
              )}
              {it.summary && (
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {it.summary}
                </p>
              )}
              {(it.source || it.date) && (
                <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-1.5">
                  {it.source && <span>{it.source}</span>}
                  {it.source && it.date && <span>·</span>}
                  {it.date && <span className="font-mono">{it.date}</span>}
                </div>
              )}
            </div>
          </div>
          {!readonly && (
            <div className="absolute top-0 right-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => toggleRead(i)}
                disabled={pending}
                aria-label={it.read ? "Отметить непрочитанным" : "Отметить прочитанным"}
                title={it.read ? "Отметить непрочитанным" : "Прочитано"}
                className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-muted-foreground hover:text-emerald-600 disabled:opacity-30"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => dismiss(i)}
                disabled={pending}
                aria-label="Убрать новость"
                title="Убрать"
                className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
