"use client";

import { useTransition } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runInitAction } from "@/lib/server/actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

export function RunInitButton({
  rootPath,
  rootId,
}: {
  rootPath: string;
  rootId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const t = toast.loading(
            "Running agent — this can take a minute or two…",
          );
          const res = await runInitAction(rootPath, rootId, false);
          toast.dismiss(t);
          if (!res.ok) {
            toast.error(res.error ?? "Init failed");
          } else {
            toast.success("Init complete");
            dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
            dispatchReflex(REFLEX_EVENTS.rootsChanged);
          }
        })
      }
      disabled={pending}
    >
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…
        </>
      ) : (
        <>
          <Play className="mr-2 h-4 w-4" /> Run init
        </>
      )}
    </Button>
  );
}
