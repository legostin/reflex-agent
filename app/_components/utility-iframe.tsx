"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestGrantAction } from "@/lib/server/utilities/sharing-actions";
import { UtilityAskLauncher } from "./utility-ask-launcher";

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

interface GrantRequest {
  consumer: string;
  provider: string;
  plane: "data" | "capability";
  selector: string;
  scope: string;
}

interface ConsentReq {
  rpcId: number;
  method: string;
  args: unknown;
  grantRequest: GrantRequest;
}

type HostResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; grantRequest?: GrantRequest };

/**
 * Hosts a utility iframe and bridges its `host-rpc` postMessage calls to
 * the server's `/host` endpoint. Replies are posted back to the iframe
 * with the same id so the in-iframe Promise can resolve.
 *
 * When a Share Plane call returns `grant_required`, the bridge raises a
 * host-rendered consent prompt (unspoofable — the requesting utility never
 * draws it). On approval it records the grant and retries the original call
 * transparently, so the utility's own code never has to handle consent.
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
  const [consent, setConsent] = useState<ConsentReq | null>(null);
  const qs = rootId ? `?rootId=${encodeURIComponent(rootId)}` : "";
  const src = `/api/utilities/${scope}/${id}/iframe${qs}`;
  const hostUrl = `/api/utilities/${scope}/${id}/host${qs}`;

  const postResult = (rpcId: number, payload: HostResult) => {
    iframeRef.current?.contentWindow?.postMessage(
      payload.ok
        ? { type: "host-rpc-result", id: rpcId, ok: true, result: payload.result }
        : { type: "host-rpc-result", id: rpcId, ok: false, error: payload.error },
      "*",
    );
  };

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
        const body = (await res.json()) as HostResult;
        // A Share Plane call that needs consent → raise the host prompt instead
        // of bubbling the error; the original rpc stays unresolved until the
        // user decides, then we retry (approve) or reject (deny).
        if (
          !body.ok &&
          body.grantRequest &&
          typeof rpcId === "number" &&
          typeof data.method === "string"
        ) {
          setConsent({
            rpcId,
            method: data.method,
            args: data.args,
            grantRequest: body.grantRequest,
          });
          return;
        }
        if (typeof rpcId === "number") {
          postResult(
            rpcId,
            body.ok
              ? { ok: true, result: body.result }
              : { ok: false, error: body.error ?? `HTTP ${res.status}` },
          );
        }
      } catch (err) {
        if (typeof rpcId === "number") {
          postResult(rpcId, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [hostUrl]);

  const approveConsent = async () => {
    const c = consent;
    if (!c) return;
    setConsent(null);
    try {
      const r = await requestGrantAction(c.grantRequest);
      if (!r.ok) throw new Error("could not record the grant");
      // Retry the original call now that the grant exists.
      const res = await fetch(hostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: c.method, args: c.args }),
      });
      const body = (await res.json()) as HostResult;
      postResult(
        c.rpcId,
        body.ok
          ? { ok: true, result: body.result }
          : { ok: false, error: body.error ?? `HTTP ${res.status}` },
      );
    } catch (err) {
      postResult(c.rpcId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const denyConsent = () => {
    const c = consent;
    if (!c) return;
    setConsent(null);
    postResult(c.rpcId, { ok: false, error: "access denied by user" });
  };

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

  const consentDialog = consent ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <ShieldQuestion className="h-5 w-5 text-violet-500" />
          <h3 className="text-sm font-semibold">Cross-utility access</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-foreground">
            {consent.grantRequest.consumer}
          </span>{" "}
          {consent.grantRequest.plane === "data" ? (
            <>
              wants to read your{" "}
              <span className="font-mono text-foreground">
                {consent.grantRequest.selector}
              </span>{" "}
              data from{" "}
              <span className="font-mono text-foreground">
                {consent.grantRequest.provider}
              </span>
              .
            </>
          ) : (
            <>
              wants to run{" "}
              <span className="font-mono text-foreground">
                {consent.grantRequest.provider}
              </span>
              &apos;s{" "}
              <span className="font-mono text-foreground">
                {consent.grantRequest.selector}
              </span>{" "}
              action.
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          It only gets what you allow here — nothing else. Revoke any time in
          Settings → Sharing.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={denyConsent}>
            Deny
          </Button>
          <Button size="sm" onClick={() => void approveConsent()}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  ) : null;

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
    return (
      <>
        {iframe}
        {consentDialog}
      </>
    );
  }

  // Iframe fills the space; the ask-launcher floats over its bottom-right
  // corner. No more horizontal real-estate lost to an embedded chat.
  return (
    <div className="relative h-full w-full">
      {iframe}
      <UtilityAskLauncher
        utilityId={id}
        {...(utilityName ? { utilityName } : {})}
        {...(rootId ? { rootId } : {})}
        requestSnapshot={requestSnapshot}
      />
      {consentDialog}
    </div>
  );
}
