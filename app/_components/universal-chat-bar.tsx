"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { sendToDispatcherAction } from "@/lib/server/home/actions";
import {
  ChatInputForm,
  type ChatInputPayload,
} from "@/app/roots/[id]/_components/chat-input-form";
import { CommandBarFrame } from "@/app/roots/[id]/_components/command-bar-frame";

// The home root id (registry.HOME_ROOT_ID) — hardcoded to avoid importing the
// server-only registry into this client component. Used for @-mention context.
const HOME_ROOT_ID = "home";

/**
 * Daily Home's compose bar — sends straight to the DISPATCHER (the central,
 * always-on thread shared with Telegram). No Space picker: the dispatcher
 * decides what to do / where to route, so the user just writes here and the
 * message lands in the one dispatcher conversation.
 */
export function UniversalChatBar() {
  const router = useRouter();
  const t = useTranslations("app");
  const [, startSend] = useTransition();

  const handleSubmit = async (payload: ChatInputPayload): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      startSend(async () => {
        const res = await sendToDispatcherAction(
          payload.message,
          payload.attachments,
        );
        if (!res.ok) {
          toast.error(res.error);
          resolve(false);
          return;
        }
        router.push(res.href);
        resolve(true);
      });
    });
  };

  return (
    <CommandBarFrame label={t("universal.label")}>
      <ChatInputForm
        rootId={HOME_ROOT_ID}
        placeholder={t("universal.placeholder")}
        submitLabel={t("universal.submitLabel")}
        pendingLabel={t("universal.pendingLabel")}
        SubmitIcon={Send}
        onSubmit={handleSubmit}
      />
    </CommandBarFrame>
  );
}
