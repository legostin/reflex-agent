"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { removeUtilityAction } from "@/lib/server/utilities/actions";
import type { UtilityScope } from "@/lib/server/utilities/types";

export function RemoveUtilityButton({
  scope,
  id,
  name,
  rootId,
}: {
  scope: UtilityScope;
  id: string;
  name: string;
  rootId?: string;
}) {
  const t = useTranslations("app");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(t("utilities.removeConfirm", { name })))
          return;
        start(async () => {
          const res = await removeUtilityAction(scope, id, rootId);
          if (!res.ok) toast.error(res.error ?? t("utilities.removeFailed"));
          else {
            toast.success(t("utilities.removed"));
            router.refresh();
          }
        });
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}
