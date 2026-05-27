"use client";

import { UtilityIframe } from "@/app/_components/utility-iframe";

interface Props {
  scope: "global" | "project";
  id: string;
  rootId?: string;
  agentChat?: boolean;
  utilityName?: string;
}

/**
 * Thin wrapper around the shared `UtilityIframe`. Kept as a named
 * component so the authenticated route can sit next to the manifest
 * panel and pick up styling without leaking the iframe markup details.
 */
export function UtilityFrame({
  scope,
  id,
  rootId,
  agentChat,
  utilityName,
}: Props) {
  return (
    <UtilityIframe
      scope={scope}
      id={id}
      {...(rootId ? { rootId } : {})}
      {...(agentChat ? { agentChat: true } : {})}
      {...(utilityName ? { utilityName } : {})}
    />
  );
}
