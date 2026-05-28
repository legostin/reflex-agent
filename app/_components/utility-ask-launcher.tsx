"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { startUtilityHelperChatAction } from "@/lib/server/topic-actions";

interface Props {
  utilityId: string;
  utilityName?: string;
  rootId?: string;
  /** Imperative way to ask the iframe for fresh state. Resolves with
   *  whatever the utility chose to expose (or undefined if no listener). */
  requestSnapshot: () => Promise<unknown>;
}

/**
 * Compact "ask the agent about this mini-app" launcher. Replaces the
 * old always-open embedded chat sidebar, which ate horizontal space and
 * rendered a cramped, clipped transcript.
 *
 * Collapsed: a small floating button at the bottom-right of the iframe.
 * Expanded: a composer styled like the main chat input. On submit we
 * snapshot the iframe, start a fresh helper topic seeded with that
 * context + the question, fire the first turn, and open the full chat
 * in a new tab — where there's room for the real conversation UI.
 */
export function UtilityAskLauncher({
  utilityId,
  utilityName,
  rootId,
  requestSnapshot,
}: Props) {
  const t = useTranslations("app");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startSend] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const projectOnly = !rootId;

  const submit = () => {
    const question = draft.trim();
    if (!question || !rootId || pending) return;
    startSend(async () => {
      let context: string | undefined;
      try {
        const snapshot = await Promise.race([
          requestSnapshot(),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), 600),
          ),
        ]);
        if (snapshot !== undefined) {
          context =
            typeof snapshot === "string"
              ? snapshot
              : JSON.stringify(snapshot, null, 2);
        }
      } catch {
        /* no snapshot — proceed without context */
      }
      const res = await startUtilityHelperChatAction({
        rootId,
        utilityId,
        utilityName: utilityName ?? utilityId,
        question,
        ...(context ? { context } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Open the full chat in a new tab — the turn is already running.
      window.open(`/roots/${rootId}/chat/${res.topicId}`, "_blank");
      setDraft("");
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 bottom-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full reflex-gradient text-white shadow-lg hover:opacity-90"
        title={t("utilities.iframe.openHelper")}
        aria-label={t("utilities.iframe.openHelper")}
      >
        <Sparkles className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute right-3 bottom-3 z-10 w-[min(28rem,calc(100%-1.5rem))]">
      <div className="rounded-xl border bg-card shadow-xl">
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Sparkles className="h-3.5 w-3.5 text-violet-600 shrink-0" />
          <span className="text-sm font-medium truncate">
            {t("utilities.ask.title", { name: utilityName ?? utilityId })}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
            title={t("utilities.ask.close")}
            aria-label={t("utilities.ask.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-2">
          {projectOnly ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("utilities.helper.projectOnly")}
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("utilities.ask.placeholder")}
                rows={1}
                disabled={pending}
                className="resize-none min-h-[44px] max-h-40 text-sm bg-background/70 py-2.5 flex-1"
              />
              <Button
                type="button"
                size="lg"
                onClick={submit}
                disabled={pending || !draft.trim()}
                className="h-11 px-5 shadow-md shrink-0"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
          <p className="px-1 pt-1.5 text-[10px] text-muted-foreground">
            {t("utilities.ask.hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
