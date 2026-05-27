"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { removeRootAction } from "@/lib/server/actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

export function RemoveRootButton({
  id,
  path,
  redirectHome,
}: {
  id: string;
  path: string;
  /** When true, navigate to "/" after a successful delete (the project
   *  page we're on no longer exists). */
  redirectHome?: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Delete Space"
      onClick={() => {
        const ok = confirm(
          `Delete this Space?\n\n` +
            `Path: ${path}\n\n` +
            `This wipes the .reflex/ folder (KB, topics, memory, ` +
            `suggestions, audit) and removes mentions of "${
              path.split("/").pop() ?? path
            }" from global memory.\n\n` +
            `Your own files in the folder are NOT touched.\n\n` +
            `This cannot be undone.`,
        );
        if (!ok) return;
        start(async () => {
          const res = await removeRootAction(id);
          if (!res.ok) {
            toast.error(res.error ?? "Failed to delete");
          } else {
            toast.success("Space deleted");
            dispatchReflex(REFLEX_EVENTS.rootsChanged);
            if (redirectHome) router.push("/");
          }
        });
      }}
    >
      <Trash2 className="h-4 w-4 text-muted-foreground" />
    </Button>
  );
}
