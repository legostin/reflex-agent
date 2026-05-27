"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Удалить утилиту "${name}"?\nКод и данные в data/ будут стёрты.`))
          return;
        start(async () => {
          const res = await removeUtilityAction(scope, id, rootId);
          if (!res.ok) toast.error(res.error ?? "не получилось");
          else {
            toast.success("Удалено");
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
