"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import type { Settings } from "@/lib/settings";
import {
  getTunnelStatusAction,
  patchNgrokSettingsAction,
  refreshReservedDomainsAction,
  startTunnelAction,
  stopTunnelAction,
} from "@/lib/server/ngrok/actions";
import { deleteShareAction, listSharesAction } from "@/lib/server/shares/actions";
import type { Share } from "@/lib/server/shares/types";

/**
 * Settings panel for the ngrok-backed public sharing flow. Reflex spawns
 * the `ngrok` CLI itself — the user pastes their authtoken (and an
 * optional API key for fetching the list of reserved domains) and the
 * panel keeps a live view of the tunnel state and existing shares.
 *
 * The panel is intentionally opinionated about scope: it does NOT try to
 * be a full ngrok dashboard. The user keeps editing/billing/regions in
 * ngrok's own UI; Reflex just plugs in.
 */
interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

interface TunnelView {
  running: boolean;
  publicUrl?: string;
  startedAt?: string;
  port?: number;
  domain?: string;
}

interface ReservedDomain {
  id: string;
  domain: string;
  region: string;
}

export function NgrokSection({ settings, onChange }: Props) {
  const t = useTranslations("settings");
  const ngrok = settings.ngrok;
  const [status, setStatus] = useState<TunnelView>({ running: false });
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [reservedDomains, setReservedDomains] = useState<ReservedDomain[] | null>(
    null,
  );
  const [shares, setShares] = useState<Share[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [savedTick, setSavedTick] = useState(0);
  // Debounce timer for the auto-save / auto-fetch-domains side effects.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The apiKey value we last sent through "fetch domains" — used to avoid
  // re-firing on every unrelated change.
  const lastFetchedApiKeyRef = useRef<string>("");

  const refresh = async () => {
    const r = await getTunnelStatusAction();
    setStatus(r.status);
    setCliVersion(r.cliVersion);
    const s = await listSharesAction();
    setShares(s.shares);
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, []);

  const refreshDomains = async (silent = false) => {
    const r = await refreshReservedDomainsAction();
    if (!r.ok) {
      if (!silent) toast.error(r.error);
      return;
    }
    setReservedDomains(r.domains);
    if (!silent) toast.success(t("ngrok.domainsLoadedToast", { count: r.domains.length }));
  };

  // Auto-save settings.ngrok on edit so the user doesn't have to scroll
  // up and click "Save". Debounced — input-by-input writes would thrash
  // disk and the toast.
  const patch = (partial: Partial<Settings["ngrok"]>) => {
    const next = { ...ngrok, ...partial };
    onChange({ ngrok: next });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const res = await patchNgrokSettingsAction(partial);
      if (!res.ok) {
        toast.error(t("ngrok.ngrokSaveError", { error: res.error ?? t("ngrok.saveFailedFallback") }));
        return;
      }
      setSavedTick((t) => t + 1);
      // If apiKey just became non-empty (and changed), pull the domain list
      // automatically — that's exactly the moment the user expects it.
      if (
        typeof partial.apiKey === "string" &&
        partial.apiKey.trim() &&
        partial.apiKey !== lastFetchedApiKeyRef.current
      ) {
        lastFetchedApiKeyRef.current = partial.apiKey;
        void refreshDomains(true);
      }
    }, 600);
  };

  // First-mount: if we already have an apiKey, fetch domains once.
  useEffect(() => {
    if (ngrok.apiKey.trim() && lastFetchedApiKeyRef.current === "") {
      lastFetchedApiKeyRef.current = ngrok.apiKey;
      void refreshDomains(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDomainsManually = () => {
    startRefresh(async () => {
      await refreshDomains();
    });
  };

  // Flush any debounced settings save before starting the tunnel — the
  // backend reads settings.ngrok from disk, so a still-pending writeFile
  // would mean stale auth/domain when the spawn happens.
  const flushPendingSave = async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await patchNgrokSettingsAction(ngrok);
    }
  };

  const start = () => {
    startToggle(async () => {
      await flushPendingSave();
      const r = await startTunnelAction();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.publicUrl
          ? t("ngrok.tunnelStarted", { url: r.publicUrl })
          : t("ngrok.tunnelStartedNoUrl"),
      );
      await refresh();
    });
  };
  const stop = () => {
    startToggle(async () => {
      await stopTunnelAction();
      toast.success(t("ngrok.tunnelStoppedToast"));
      await refresh();
    });
  };
  const restart = () => {
    startToggle(async () => {
      await flushPendingSave();
      await stopTunnelAction();
      // Small breath so ngrok agent releases the port before we respawn.
      await new Promise((r) => setTimeout(r, 400));
      const r = await startTunnelAction();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.publicUrl
          ? t("ngrok.tunnelRestarted", { url: r.publicUrl })
          : t("ngrok.tunnelRestartedNoUrl"),
      );
      await refresh();
    });
  };

  // Compare the configured domain with what ngrok actually serves so we
  // can prompt the user to restart when they change settings mid-tunnel.
  const runningHost = (() => {
    try {
      return status.publicUrl ? new URL(status.publicUrl).hostname : "";
    } catch {
      return "";
    }
  })();
  const desiredDomain = ngrok.domain.trim();
  const domainMismatch =
    status.running && desiredDomain && runningHost !== desiredDomain;
  const portMismatch = status.running && status.port !== ngrok.port;

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4 text-violet-600" />
          <span>{t("ngrok.headerTitle")}</span>
          {cliVersion ? (
            <span className="text-[10px] font-mono text-muted-foreground ml-1">
              {cliVersion.split("\n")[0]}
            </span>
          ) : (
            <span className="text-[10px] text-destructive ml-1 inline-flex items-center gap-0.5">
              <AlertTriangle className="h-3 w-3" />
              {t("ngrok.cliMissing")}
            </span>
          )}
          {savedTick > 0 && (
            <span
              key={savedTick}
              className="ml-auto text-[10px] text-emerald-700 inline-flex items-center gap-0.5"
              title={t("ngrok.autoSavedTooltip")}
            >
              <CheckCircle2 className="h-3 w-3" />
              {t("ngrok.autoSavedLabel")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t.rich("ngrok.intro", {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
            path: () => <code className="font-mono">/share/*</code>,
            link: (chunks) => (
              <a
                href="https://ngrok.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>

        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="ngrok-token">
            {t("ngrok.authtokenLabel")}
          </label>
          <input
            id="ngrok-token"
            type="password"
            autoComplete="off"
            value={ngrok.authtoken}
            onChange={(e) => patch({ authtoken: e.target.value })}
            placeholder="2abc...xyz"
            className="rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <p className="text-[10px] text-muted-foreground">
            {t.rich("ngrok.authtokenHint", {
              code: (chunks) => <code className="font-mono">{chunks}</code>,
              path: () => <code className="font-mono">~/.reflex/ngrok.yml</code>,
              link: (chunks) => (
                <a
                  href="https://dashboard.ngrok.com/get-started/your-authtoken"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="ngrok-apikey">
            {t("ngrok.apiKeyLabel")}
          </label>
          <input
            id="ngrok-apikey"
            type="password"
            autoComplete="off"
            value={ngrok.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="2abc...xyz"
            className="rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <p className="text-[10px] text-muted-foreground">
            {t.rich("ngrok.apiKeyHint", {
              link: (chunks) => (
                <a
                  href="https://dashboard.ngrok.com/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" htmlFor="ngrok-domain">
              {t("ngrok.reservedDomainLabel")}
            </label>
            <button
              type="button"
              onClick={refreshDomainsManually}
              disabled={refreshing || !ngrok.apiKey}
              className="text-[11px] inline-flex items-center gap-1 text-violet-700 hover:underline disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t("ngrok.refreshList")}
            </button>
          </div>
          {reservedDomains && reservedDomains.length > 0 ? (
            <select
              id="ngrok-domain"
              value={ngrok.domain}
              onChange={(e) => patch({ domain: e.target.value })}
              className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">{t("ngrok.randomSubdomain")}</option>
              {reservedDomains.map((d) => (
                <option key={d.id} value={d.domain}>
                  {d.domain}
                  {d.region ? ` (${d.region})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="ngrok-domain"
              type="text"
              value={ngrok.domain}
              onChange={(e) => patch({ domain: e.target.value })}
              placeholder={t("ngrok.domainPlaceholder")}
              className="rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="text-xs font-medium" htmlFor="ngrok-port">
              {t("ngrok.localPortLabel")}
            </label>
            <input
              id="ngrok-port"
              type="number"
              min={1}
              max={65535}
              value={ngrok.port}
              onChange={(e) =>
                patch({ port: Math.max(1, Number(e.target.value) || 3210) })
              }
              className="mt-1 w-32 rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          {status.running ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={restart}
                disabled={toggling}
                className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
                title={t("ngrok.restartTitle")}
              >
                {toggling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {t("ngrok.restart")}
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={toggling}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {toggling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Square className="h-3 w-3" />
                )}
                {t("ngrok.stop")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={toggling || !ngrok.authtoken}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {toggling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {t("ngrok.start")}
            </button>
          )}
        </div>

        {status.running && (
          <div className="rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/50 px-3 py-2 text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{t("ngrok.tunnelActive")}</span>
            </div>
            {status.publicUrl ? (
              <a
                href={status.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-violet-700 hover:underline truncate"
              >
                {status.publicUrl}
              </a>
            ) : (
              <p className="text-muted-foreground">{t("ngrok.urlPending")}</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {t("ngrok.startedAt", {
                time: status.startedAt ? new Date(status.startedAt).toLocaleTimeString() : "",
                port: status.port ?? "",
              })}
            </p>
          </div>
        )}

        {(domainMismatch || portMismatch) && (
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 px-3 py-2 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("ngrok.settingsChanged")}
            </div>
            <ul className="text-[11px] text-amber-900 dark:text-amber-100 list-disc pl-4 space-y-0.5">
              {domainMismatch && (
                <li>
                  {t.rich("ngrok.domainMismatch", {
                    code: (chunks) => <code className="font-mono">{chunks}</code>,
                    running: runningHost,
                    desired: desiredDomain,
                  })}
                </li>
              )}
              {portMismatch && (
                <li>
                  {t.rich("ngrok.portMismatch", {
                    code: (chunks) => <code className="font-mono">{chunks}</code>,
                    running: status.port ?? "",
                    desired: ngrok.port,
                  })}
                </li>
              )}
            </ul>
            <button
              type="button"
              onClick={restart}
              disabled={toggling}
              className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {toggling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t("ngrok.restartWithNewSettings")}
            </button>
          </div>
        )}

        <hr className="my-3" />

        <div>
          <h3 className="text-xs font-semibold mb-2">
            {t("ngrok.activeLinks", { count: shares.length })}
          </h3>
          {shares.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t("ngrok.noShares")}
            </p>
          ) : (
            <ul className="space-y-1">
              {shares.map((s) => (
                <ShareRow
                  key={s.id}
                  share={s}
                  publicHost={status.publicUrl}
                  onDeleted={() => void refresh()}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ShareRow({
  share,
  publicHost,
  onDeleted,
}: {
  share: Share;
  publicHost?: string;
  onDeleted: () => void;
}) {
  const t = useTranslations("settings");
  const [deleting, startDelete] = useTransition();
  const url = publicHost
    ? new URL(`/share/${share.id}`, publicHost).toString()
    : `/share/${share.id}`;
  const label =
    share.label ||
    (share.kind === "utility"
      ? t("ngrok.shareLabel.utility", { id: share.utilityId ?? "" })
      : share.kind === "kb-file"
        ? t("ngrok.shareLabel.kbFile", { path: share.kbRelPath ?? "" })
        : share.kind === "kb-tree"
          ? t("ngrok.shareLabel.kbTree")
          : t("ngrok.shareLabel.dashboard"));
  const remove = () => {
    if (!confirm(t("ngrok.deleteConfirm", { label }))) return;
    startDelete(async () => {
      await deleteShareAction(share.id);
      onDeleted();
    });
  };
  return (
    <li className="flex items-start gap-2 rounded border bg-card px-2 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">{label}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {share.kind}
          </span>
          {share.passwordHash && (
            <span className="text-[9px] uppercase tracking-wider text-violet-600">
              🔒
            </span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[10px] font-mono text-violet-700 hover:underline truncate"
        >
          {url}
        </a>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => toast.success(t("ngrok.copiedToast")));
        }}
        className="text-[10px] text-muted-foreground hover:text-foreground rounded px-1 py-0.5"
      >
        copy
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="text-muted-foreground hover:text-destructive rounded px-1"
        title={t("ngrok.deleteTitle")}
      >
        {deleting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Trash2 className="h-3 w-3" />
        )}
      </button>
    </li>
  );
}
