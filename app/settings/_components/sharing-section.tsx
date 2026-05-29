"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Settings } from "@/lib/settings";
import type { GrantView } from "@/lib/server/utilities/grant-store";
import type { ProviderEntry } from "@/lib/server/utilities/provider-directory";
import {
  listGrantsAction,
  revokeGrantAction,
  listProvidersAction,
} from "@/lib/server/utilities/sharing-actions";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * Settings → Sharing (docs/sharing.md, Stage 4). The `requireScopedReads`
 * toggle is part of the form (saved with the page's Save button); grants and
 * the provider directory are fetched live and revoked in place.
 */
export function SharingSection({ settings, onChange }: Props) {
  const [grants, setGrants] = useState<GrantView[] | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, startRevoke] = useTransition();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, p] = await Promise.all([
        listGrantsAction(),
        listProvidersAction(),
      ]);
      setGrants(g);
      setProviders(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = (id: string) => {
    startRevoke(async () => {
      const res = await revokeGrantAction(id);
      if (res.ok) {
        toast.success("Grant revoked");
        void refresh();
      } else {
        toast.error("Could not revoke (already revoked?)");
      }
    });
  };

  const requireScoped = settings.sharing?.requireScopedReads ?? false;

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Require scoped reads</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Narrow blanket <code className="font-mono">kb.read</code> to a
              utility&apos;s own entries plus the kinds it&apos;s been granted,
              forcing the granular <code className="font-mono">kb.scoped*</code>{" "}
              path. Off by default — existing utilities keep working. Saved with
              the Save button below.
            </p>
          </div>
          <Switch
            checked={requireScoped}
            onCheckedChange={(v) =>
              onChange({ sharing: { requireScopedReads: v } })
            }
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">
              Active cross-utility grants
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
          {grants === null ? (
            <p className="text-xs text-muted-foreground">
              <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> loading…
            </p>
          ) : grants.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              No grants yet. A utility requests access (and you approve it) the
              first time it needs another utility&apos;s data.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {grants.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
                >
                  <Badge
                    variant={g.plane === "capability" ? "default" : "secondary"}
                    className="uppercase text-[10px]"
                  >
                    {g.plane}
                  </Badge>
                  <span className="font-mono">{g.consumer}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono">{g.provider}</span>
                  <span className="text-muted-foreground">/ {g.selector}</span>
                  <span className="text-muted-foreground">
                    · {g.scope === "global" ? "all spaces" : "this space"}
                  </span>
                  {!g.active && (
                    <Badge variant="outline" className="text-[10px]">
                      {g.revoked ? "revoked" : "expired"}
                    </Badge>
                  )}
                  <span className="flex-1" />
                  {g.active && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-destructive hover:text-destructive"
                      onClick={() => revoke(g.id)}
                      disabled={revoking}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {providers && providers.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground">
              Installed providers
            </Label>
            <ul className="mt-2 space-y-1.5">
              {providers.map((p) => (
                <li
                  key={`${p.provider}:${p.rootId ?? "global"}`}
                  className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
                >
                  <span className="font-mono font-medium">{p.provider}</span>
                  {p.data.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      data: {p.data.map((d) => d.kind).join(", ")}
                    </span>
                  )}
                  {p.capabilities.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      verbs: {p.capabilities.map((c) => c.verb).join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
