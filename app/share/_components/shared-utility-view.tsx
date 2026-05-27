import { Share2 } from "lucide-react";
import type { Manifest } from "@/lib/server/utilities/types";
import { UtilityIframe } from "@/app/_components/utility-iframe";

/**
 * Renders a publicly-shared utility inside its sandboxed iframe via the
 * shared `<UtilityIframe>` component, which carries the postMessage RPC
 * bridge to the server's `/host` endpoint. Without that bridge, any
 * utility that issues a host call would hang on the loading screen.
 *
 * The host's permission model still applies (utility code runs in a
 * worker, CSP blocks direct network, only the bridged RPC reaches the
 * filesystem / agent).
 */
export function SharedUtilityView({
  scope,
  id,
  rootId,
  manifest,
}: {
  scope: "global" | "project";
  id: string;
  rootId?: string;
  manifest: Manifest;
}) {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center gap-2">
        <Share2 className="h-3.5 w-3.5 text-violet-600" />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate">{manifest.name}</h1>
          <p className="text-[11px] text-muted-foreground truncate">
            v{manifest.version} · {scope} · Reflex Share
          </p>
        </div>
      </header>
      <UtilityIframe
        scope={scope}
        id={id}
        {...(rootId ? { rootId } : {})}
        className="flex-1 w-full bg-background border-0"
        title={manifest.name}
      />
    </main>
  );
}
