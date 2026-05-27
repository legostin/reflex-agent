"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteTopicAction } from "@/lib/server/topic-actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

/**
 * Hard-delete the current topic. Bounces back to the project dashboard on
 * success. Used in the chat-page header (server component); a small client
 * island here keeps the page tree mostly server-rendered.
 */
export function DeleteTopicButton({
  rootId,
  topicId,
  topicTitle,
}: {
  rootId: string;
  topicId: string;
  topicTitle: string;
}) {
  const t = useTranslations("roots");
  const [pending, start] = useTransition();
  const router = useRouter();

  const onClick = () => {
    if (!confirm(t("deleteTopic.confirm", { title: topicTitle }))) {
      return;
    }
    start(async () => {
      const res = await deleteTopicAction(rootId, topicId);
      if (!res.ok) {
        toast.error(res.error ?? t("deleteTopic.deleteFailed"));
        return;
      }
      toast.success(t("deleteTopic.deleted"));
      dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
      router.push(`/roots/${rootId}`);
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={pending}
      className="gap-1 h-8 text-muted-foreground hover:text-destructive"
      title={t("deleteTopic.title")}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      <span className="text-xs">{t("deleteTopic.label")}</span>
    </Button>
  );
}
