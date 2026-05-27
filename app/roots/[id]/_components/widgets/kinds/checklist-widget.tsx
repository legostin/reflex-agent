"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChecklistData } from "@/lib/server/widgets/types";

type Item = ChecklistData["items"][number];

/**
 * Interactive checklist:
 *   - click the box to toggle `done` (line-through + dim when done)
 *   - X button per item to delete
 *   - "+ Добавить" pinned at the bottom to add new items
 *
 * Optimistic state: every mutation updates local items immediately, then
 * fires `onPatch` with the new full data. On server error the toast
 * surfaces from the wrapper; we revert to the props-derived state on the
 * next prop sync.
 */
export function ChecklistWidget({
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: ChecklistData;
  readonly?: boolean;
  onPatch?: (next: ChecklistData) => Promise<void> | void;
}) {
  const initial = data.items ?? [];
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, startSave] = useTransition();
  const [draft, setDraft] = useState("");
  // Keep local state in sync when the agent updates the widget via
  // widget-update (e.g. auto-refresh added new items). Comparing the
  // serialized form is cheap and avoids stomping in-flight edits.
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
        // Wrapper already toasted; revert on next prop sync.
      }
    });
  };

  const toggle = (i: number) => {
    if (readonly) return;
    persist(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  };

  const remove = (i: number) => {
    if (readonly) return;
    persist(items.filter((_, idx) => idx !== i));
  };

  const add = () => {
    if (readonly) return;
    const text = draft.trim();
    if (!text) return;
    persist([...items, { text, done: false }]);
    setDraft("");
  };

  if (items.length === 0 && readonly) {
    return <p className="text-xs text-muted-foreground">Список пустой.</p>;
  }

  return (
    <div className="space-y-1.5">
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={`group/row flex items-start gap-2 text-sm py-0.5 rounded hover:bg-accent/30 px-1 -mx-1 ${
              it.done ? "text-muted-foreground" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(i)}
              disabled={readonly || pending}
              aria-label={it.done ? "Снять отметку" : "Отметить выполненным"}
              className="shrink-0 mt-0.5 disabled:opacity-50"
            >
              {it.done ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Square className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-foreground" />
              )}
            </button>
            <span
              className={`flex-1 min-w-0 break-words ${it.done ? "line-through" : ""}`}
              onClick={() => toggle(i)}
              style={readonly ? {} : { cursor: "pointer" }}
            >
              {it.text}
            </span>
            {!readonly && (
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={pending}
                aria-label="Удалить пункт"
                className="opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0 p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!readonly && (
        <form
          className="flex items-center gap-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Новый пункт…"
            className="h-7 text-xs flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
            disabled={pending}
          />
          {draft.trim() && (
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] px-1.5"
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Добавить"
              )}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
