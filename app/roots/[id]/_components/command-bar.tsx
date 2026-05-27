"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { toast } from "sonner";
import {
  generateTopicTitleAction,
  startTopicAction,
} from "@/lib/server/topic-actions";
import { CommandBarFrame } from "./command-bar-frame";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";
import { ChatInputForm } from "./chat-input-form";

interface Props {
  rootId: string;
  /**
   * Rel-path of the KB file the user is currently reading. Passed to the
   * topic-start so the orchestrator treats it as primary context.
   */
  focusFile?: string;
}

export function CommandBar({ rootId, focusFile }: Props) {
  const t = useTranslations("roots");
  const [, start] = useTransition();
  const router = useRouter();

  return (
    <CommandBarFrame label={t("commandBar.label")}>
      <ChatInputForm
        rootId={rootId}
        placeholder={t("commandBar.placeholder")}
        submitLabel={t("commandBar.submit")}
        pendingLabel={t("commandBar.submitPending")}
        SubmitIcon={Send}
        onSubmit={async ({ message, attachments }) =>
          await new Promise<boolean>((resolve) => {
            start(async () => {
              const res = await startTopicAction(
                rootId,
                message,
                attachments,
                focusFile,
              );
              if (!res.ok) {
                toast.error(res.error ?? t("commandBar.startFailed"));
                resolve(false);
                return;
              }
              dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
              if (message.trim()) {
                void generateTopicTitleAction(
                  rootId,
                  res.topicId,
                  message,
                ).then((r) => {
                  if (r.ok) dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
                });
              }
              router.push(`/roots/${rootId}/chat/${res.topicId}`);
              resolve(true);
            });
          })
        }
      />
    </CommandBarFrame>
  );
}
