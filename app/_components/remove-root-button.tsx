"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeRootAction } from "@/lib/server/actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

export function RemoveRootButton({
  id,
  path,
}: {
  id: string;
  path: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${path} from Reflex?\n(The .reflex/ folder on disk is not deleted.)`)) {
          return;
        }
        start(async () => {
          const res = await removeRootAction(id);
          if (!res.ok) {
            toast.error(res.error ?? "Failed to remove");
          } else {
            toast.success("Removed");
            dispatchReflex(REFLEX_EVENTS.rootsChanged);
          }
        });
      }}
    >
      <Trash2 className="h-4 w-4 text-muted-foreground" />
    </Button>
  );
}
