"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Send } from "lucide-react";
import { toast } from "sonner";
import {
  generateTopicTitleAction,
  startTopicAction,
} from "@/lib/server/topic-actions";
import {
  ChatInputForm,
  type ChatInputPayload,
} from "@/app/roots/[id]/_components/chat-input-form";
import { CommandBarFrame } from "@/app/roots/[id]/_components/command-bar-frame";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

interface SpaceOption {
  id: string;
  label: string;
}

interface Props {
  spaces: SpaceOption[];
}

/**
 * Daily Home's "ask Reflex" bar — visually identical to the per-project
 * `CommandBar` (same `CommandBarFrame`, same `ChatInputForm`, same submit
 * pipeline). The only delta is the absence of a topic: submit creates
 * one in the picked Space and navigates the user into it.
 *
 * When 2+ Spaces exist, a tiny picker chip lives in the frame's header
 * (right side). Single-Space users never see the picker.
 */
export function UniversalChatBar({ spaces }: Props) {
  const router = useRouter();
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(
    spaces[0]?.id ?? "",
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [, startSend] = useTransition();
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const activeSpace =
    spaces.find((s) => s.id === selectedSpaceId) ?? spaces[0];

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  if (!activeSpace) {
    return (
      <div className="border-t bg-background">
        <div className="mx-auto max-w-3xl px-6 py-5 text-center text-xs text-muted-foreground">
          Создай первое пространство, чтобы начать разговор —{" "}
          <a href="/onboarding?force=1" className="underline">
            мастер
          </a>{" "}
          или{" "}
          <a href="/roots/new" className="underline">
            вручную
          </a>
          .
        </div>
      </div>
    );
  }

  const picker =
    spaces.length > 1 ? (
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border bg-card/80 px-2 py-0.5 text-[10px] font-medium hover:bg-accent normal-case tracking-normal"
          title="Выбрать пространство"
        >
          <span className="text-muted-foreground">в</span>
          <span>{activeSpace.label}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {pickerOpen && (
          <ul className="absolute bottom-full right-0 mb-1 min-w-[200px] max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg z-40 py-1">
            {spaces.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSpaceId(s.id);
                    setPickerOpen(false);
                  }}
                  className={
                    "block w-full text-left px-3 py-1.5 text-sm hover:bg-accent " +
                    (s.id === activeSpace.id ? "font-semibold" : "")
                  }
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  const handleSubmit = async (payload: ChatInputPayload): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      startSend(async () => {
        const res = await startTopicAction(
          activeSpace.id,
          payload.message,
          payload.attachments,
        );
        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }
        dispatchReflex(REFLEX_EVENTS.topicsChanged(activeSpace.id));
        if (payload.message.trim()) {
          void generateTopicTitleAction(
            activeSpace.id,
            res.topicId,
            payload.message,
          ).then((r) => {
            if (r.ok)
              dispatchReflex(REFLEX_EVENTS.topicsChanged(activeSpace.id));
          });
        }
        router.push(`/roots/${activeSpace.id}/chat/${res.topicId}`);
        resolve(true);
      });
    });
  };

  return (
    <CommandBarFrame
      label="Спроси Reflex"
      {...(picker ? { headerRight: picker } : {})}
    >
      {/* Same component as the per-topic chat. Re-key on Space change so
          @-mention / palette state resets cleanly. */}
      <ChatInputForm
        key={activeSpace.id}
        rootId={activeSpace.id}
        placeholder="Задай вопрос или дай команду…"
        submitLabel="Начать"
        pendingLabel="Старт"
        SubmitIcon={Send}
        onSubmit={handleSubmit}
      />
    </CommandBarFrame>
  );
}
