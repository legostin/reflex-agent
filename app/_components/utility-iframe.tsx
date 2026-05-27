"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { UtilityChatSidebar } from "./utility-chat-sidebar";

interface Props {
  scope: "global" | "project";
  id: string;
  rootId?: string;
  className?: string;
  title?: string;
  /**
   * When true (utility's `permissions.agent.invoke` is set), render the
   * in-utility AI sidebar alongside the iframe. Caller decides because
   * the manifest is fetched server-side and we don't want a round-trip
   * inside this client component.
   */
  agentChat?: boolean;
  /** Human-readable utility name for the helper-topic title. */
  utilityName?: string;
}

/**
 * Hosts a utility iframe and bridges its `host-rpc` postMessage calls to
 * the server's `/host` endpoint. Replies are posted back to the iframe
 * with the same id so the in-iframe Promise can resolve.
 *
 * When `agentChat` is on, the iframe is wrapped in a flex row + the
 * AI sidebar. The sidebar can request a snapshot from the iframe via
 * the `request-snapshot` postMessage protocol — utilities that want to
 * expose richer context implement a `message` listener for it.
 *
 * The iframe is sandboxed with `allow-same-origin` so its ESM module
 * fetches stay same-origin (Safari/ngrok would otherwise treat the
 * sandbox as null-origin and CORS-block subresource fetches). The CSP
 * in the iframe HTML already keeps the utility from reaching the
 * network on its own — only the postMessage path is exposed.
 */
export function UtilityIframe({
  scope,
  id,
  rootId,
  className,
  title,
  agentChat,
  utilityName,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const snapshotPending = useRef<{
    resolve: (value: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const qs = rootId ? `?rootId=${encodeURIComponent(rootId)}` : "";
  const src = `/api/utilities/${scope}/${id}/iframe${qs}`;
  const hostUrl = `/api/utilities/${scope}/${id}/host${qs}`;

  useEffect(() => {
    const listener = async (e: MessageEvent) => {
      const data = e.data as
        | { type?: string; id?: number; method?: string; args?: unknown }
        | undefined;
      if (!data) return;
      if (e.source !== iframeRef.current?.contentWindow) return;

      // Snapshot reply from utility — resolve any waiting request.
      if (data.type === "snapshot-payload") {
        const slot = snapshotPending.current;
        if (slot) {
          clearTimeout(slot.timer);
          snapshotPending.current = null;
          slot.resolve((data as { snapshot?: unknown }).snapshot);
        }
        return;
      }

      if (data.type !== "host-rpc") return;
      const rpcId = data.id;
      try {
        const res = await fetch(hostUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: data.method, args: data.args }),
        });
        const body = (await res.json()) as
          | { ok: true; result: unknown }
          | { ok: false; error: string };
        iframeRef.current?.contentWindow?.postMessage(
          body.ok
            ? { type: "host-rpc-result", id: rpcId, ok: true, result: body.result }
            : {
                type: "host-rpc-result",
                id: rpcId,
                ok: false,
                error: body.error ?? `HTTP ${res.status}`,
              },
          "*",
        );
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "host-rpc-result",
            id: rpcId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          },
          "*",
        );
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [hostUrl]);

  const requestSnapshot = (): Promise<unknown> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return Promise.resolve(undefined);
    // Cancel any pending request — only one in flight at a time.
    if (snapshotPending.current) {
      clearTimeout(snapshotPending.current.timer);
      snapshotPending.current.resolve(undefined);
      snapshotPending.current = null;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (snapshotPending.current?.resolve === resolve) {
          snapshotPending.current = null;
          resolve(undefined);
        }
      }, 500);
      snapshotPending.current = { resolve, timer };
      try {
        win.postMessage({ type: "request-snapshot" }, "*");
      } catch {
        clearTimeout(timer);
        snapshotPending.current = null;
        resolve(undefined);
      }
    });
  };

  const iframe = (
    <iframe
      ref={iframeRef}
      src={src}
      sandbox="allow-scripts allow-forms allow-same-origin"
      className={className ?? "h-full w-full border-0 bg-white"}
      title={title ?? `utility-${id}`}
    />
  );

  if (!agentChat) {
    return iframe;
  }

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 min-w-0 relative">
        {iframe}
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-xs text-white shadow-lg hover:bg-violet-700"
            title="Открыть помощника"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Помощник
          </button>
        )}
      </div>
      {sidebarOpen && (
        <div className="w-80 shrink-0">
          <UtilityChatSidebar
            scope={scope}
            utilityId={id}
            {...(utilityName ? { utilityName } : {})}
            {...(rootId ? { rootId } : {})}
            requestSnapshot={requestSnapshot}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
