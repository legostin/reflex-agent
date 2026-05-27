"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OAuthSetupSteps } from "@/components/oauth-setup-steps";
import {
  addCustomOAuthProviderAction,
  beginOAuthAction,
  deleteOAuthClientAction,
  disconnectOAuthAction,
  getOAuthClientAction,
  listOAuthStatusesAction,
  probeOAuthAction,
  removeCustomOAuthProviderAction,
  saveOAuthClientAction,
} from "@/lib/server/oauth-actions";

interface Status {
  id: string;
  label: string;
  hasClient: boolean;
  hasTokens: boolean;
  expiresAt?: number;
  setupHint: string;
  consoleUrl: string;
  origin: "builtin" | "user";
  setupSteps: Array<{
    title: string;
    body?: string;
    field?: string;
    copy?: string;
    choice?: string;
  }>;
}

export function OAuthProvidersSection() {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, startLoad] = useTransition();
  const [adding, setAdding] = useState(false);

  const reload = () => {
    startLoad(async () => {
      const res = await listOAuthStatusesAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStatuses(res.statuses);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && statuses.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {statuses.map((s) => (
        <ProviderRow key={s.id} status={s} onChanged={reload} />
      ))}
      {adding ? (
        <CustomProviderForm
          existingIds={statuses.map((s) => s.id)}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          className="gap-2 text-muted-foreground"
        >
          <Plus className="h-4 w-4" />
          Добавить кастомный provider
        </Button>
      )}
    </div>
  );
}

function ProviderRow({
  status,
  onChanged,
}: {
  status: Status;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [client, setClient] = useState<{
    clientId: string;
    hasSecret: boolean;
    scopes: string[];
  } | null>(null);
  const [defaultScopes, setDefaultScopes] = useState<string[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopesText, setScopesText] = useState("");
  const [saving, startSave] = useTransition();
  const [authorizing, startAuth] = useTransition();
  const [probing, startProbe] = useTransition();

  useEffect(() => {
    if (!expanded) return;
    void (async () => {
      const res = await getOAuthClientAction(status.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setClient(res.client);
      setDefaultScopes(res.defaultScopes);
      if (res.client) {
        setClientId(res.client.clientId);
        setScopesText(res.client.scopes.join(" "));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const save = () => {
    startSave(async () => {
      const scopes = scopesText
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s.length > 0);
      const res = await saveOAuthClientAction({
        provider: status.id,
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        ...(scopes.length > 0 ? { scopes } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Client config saved");
      setClientSecret("");
      onChanged();
      const reload = await getOAuthClientAction(status.id);
      if (reload.ok) setClient(reload.client);
    });
  };

  const authorize = () => {
    startAuth(async () => {
      const res = await beginOAuthAction(status.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const popup = window.open(
        res.authorizeUrl,
        "reflex-oauth",
        "width=600,height=720,noopener=no",
      );
      if (!popup) {
        // Popup-blocked → fall back to a redirect in a new tab
        window.open(res.authorizeUrl, "_blank", "noopener");
      }
      // Poll until tokens appear (callback writes them server-side).
      const startedAt = Date.now();
      const tick = async () => {
        if (Date.now() - startedAt > 5 * 60_000) {
          toast.error("Authorization timed out");
          return;
        }
        const r = await listOAuthStatusesAction();
        if (r.ok) {
          const cur = r.statuses.find((s) => s.id === status.id);
          if (cur?.hasTokens && !status.hasTokens) {
            toast.success("Authorized");
            onChanged();
            return;
          }
        }
        setTimeout(() => void tick(), 1500);
      };
      void tick();
    });
  };

  const probe = () => {
    startProbe(async () => {
      const r = await probeOAuthAction(status.id);
      if (!r.ok) {
        toast.error(r.error ?? "probe failed");
        return;
      }
      toast.success("Access token живой");
    });
  };

  const disconnect = async () => {
    if (!confirm(`Удалить сохранённые токены для ${status.label}?`)) return;
    const res = await disconnectOAuthAction(status.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Disconnected");
    onChanged();
  };

  const forgetClient = async () => {
    if (
      !confirm(
        `Удалить весь OAuth-конфиг для ${status.label} (client_id, secret и токены)?`,
      )
    )
      return;
    const res = await deleteOAuthClientAction(status.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Forgotten");
    setClient(null);
    setClientId("");
    setScopesText("");
    onChanged();
  };

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{status.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {status.id}
              </span>
              {status.origin === "user" && (
                <Badge variant="outline" className="text-[10px]">
                  custom
                </Badge>
              )}
              {!status.hasClient ? (
                <Badge variant="outline">не настроен</Badge>
              ) : !status.hasTokens ? (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  готов к авторизации
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Check className="h-3 w-3" /> авторизован
                </Badge>
              )}
              {status.hasTokens && status.expiresAt && (
                <span className="text-[10px] text-muted-foreground">
                  истекает{" "}
                  {new Date(status.expiresAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="gap-1"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            />
            {expanded ? "Свернуть" : "Настроить"}
          </Button>
        </div>

        {expanded && (
          <div className="mt-4 pl-7 space-y-3 border-l-2 ml-1.5">
            {status.setupHint && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{status.setupHint}</span>
              </div>
            )}
            <a
              href={status.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Открыть консоль {status.label}
            </a>
            {status.setupSteps && status.setupSteps.length > 0 && (
              <div className="rounded border border-violet-200 bg-violet-50/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  Пошагово
                </div>
                <OAuthSetupSteps steps={status.setupSteps} />
              </div>
            )}

            <div>
              <Label className="text-xs">Client ID</Label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-xxxxx.apps.googleusercontent.com"
                className="font-mono text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-xs">
                Client secret
                {client?.hasSecret && (
                  <span className="ml-2 text-muted-foreground">
                    (сохранён, оставь пустым чтобы не менять)
                  </span>
                )}
              </Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  client?.hasSecret ? "••••" : "GOCSPX-…"
                }
                className="font-mono text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-xs">
                Scopes{" "}
                <span className="text-muted-foreground">
                  (по умолчанию: {defaultScopes.join(" ") || "—"})
                </span>
              </Label>
              <Input
                value={scopesText}
                onChange={(e) => setScopesText(e.target.value)}
                placeholder={defaultScopes.join(" ")}
                className="font-mono text-xs h-8"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={saving || !clientId.trim()}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                Сохранить
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={authorize}
                disabled={authorizing || !client}
                className="gap-1"
              >
                {authorizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                {status.hasTokens ? "Re-authorize" : "Authorize"}
              </Button>
              {status.hasTokens && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={probe}
                    disabled={probing}
                  >
                    {probing && (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    )}
                    <Plug className="mr-1 h-3.5 w-3.5" /> Проверить токен
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={disconnect}
                  >
                    <Unlink className="mr-1 h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </>
              )}
              {client && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={forgetClient}
                  className="text-muted-foreground"
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Forget client
                </Button>
              )}
              {status.origin === "user" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive ml-auto"
                  onClick={async () => {
                    if (
                      !confirm(
                        `Удалить custom provider "${status.id}" полностью (вместе с client + tokens)?`,
                      )
                    )
                      return;
                    const res = await removeCustomOAuthProviderAction(
                      status.id,
                    );
                    if (!res.ok) {
                      toast.error(res.error);
                      return;
                    }
                    await deleteOAuthClientAction(status.id);
                    toast.success("Provider удалён");
                    onChanged();
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Удалить provider
                </Button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Используй <code className="font-mono">$oauth:{status.id}</code> в
              env/headers любого MCP-сервера — Reflex подставит свежий
              access_token при каждом вызове (с авто-refresh'ем).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Form for registering a custom OAuth provider that isn't in Reflex's
 * built-in catalog. Persisted to `~/.reflex/oauth/providers.json`.
 */
function CustomProviderForm({
  existingIds,
  onCancel,
  onAdded,
}: {
  existingIds: string[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopesText, setScopesText] = useState("");
  const [consoleUrl, setConsoleUrl] = useState("");
  const [setupHint, setSetupHint] = useState("");
  const [supportsPKCE, setSupportsPKCE] = useState(true);
  const [refreshTokenSupported, setRefreshTokenSupported] = useState(true);
  const [needsClientSecret, setNeedsClientSecret] = useState(true);
  const [extraParamsText, setExtraParamsText] = useState("");
  const [saving, startSave] = useTransition();

  const save = () => {
    const slug = id.trim().toLowerCase();
    if (!slug) {
      toast.error("id обязателен");
      return;
    }
    if (existingIds.includes(slug)) {
      toast.error(`provider "${slug}" уже существует`);
      return;
    }
    if (!authorizeUrl.trim() || !tokenUrl.trim()) {
      toast.error("authorizeUrl и tokenUrl обязательны");
      return;
    }
    let extra: Record<string, string> = {};
    if (extraParamsText.trim()) {
      try {
        extra = JSON.parse(extraParamsText);
      } catch {
        toast.error("extraAuthorizeParams должен быть JSON-объектом");
        return;
      }
    }
    const scopes = scopesText
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0);
    startSave(async () => {
      const res = await addCustomOAuthProviderAction({
        id: slug,
        label: label.trim() || slug,
        authorizeUrl: authorizeUrl.trim(),
        tokenUrl: tokenUrl.trim(),
        defaultScopes: scopes,
        supportsPKCE,
        refreshTokenSupported,
        needsClientSecret,
        extraAuthorizeParams: extra,
        setupHint: setupHint.trim(),
        consoleUrl:
          consoleUrl.trim() || "http://localhost:3210/api/oauth/callback",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Provider "${slug}" добавлен`);
      onAdded();
    });
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" /> Кастомный OAuth provider
          </h3>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onCancel}
            className="h-7 w-7"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Любой OAuth 2.0 сервис со стандартным Authorization Code flow.
          Redirect URI:{" "}
          <code className="font-mono">
            http://localhost:3210/api/oauth/callback
          </code>
          .
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">ID (kebab-case)</Label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="dropbox"
              className="font-mono text-sm h-8"
            />
          </div>
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Dropbox"
              className="text-sm h-8"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">Authorize URL</Label>
          <Input
            value={authorizeUrl}
            onChange={(e) => setAuthorizeUrl(e.target.value)}
            placeholder="https://example.com/oauth/authorize"
            className="font-mono text-sm h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Token URL</Label>
          <Input
            value={tokenUrl}
            onChange={(e) => setTokenUrl(e.target.value)}
            placeholder="https://example.com/oauth/token"
            className="font-mono text-sm h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Default scopes (space-separated)</Label>
          <Input
            value={scopesText}
            onChange={(e) => setScopesText(e.target.value)}
            placeholder="read write"
            className="font-mono text-sm h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Console URL (где брать credentials)</Label>
          <Input
            value={consoleUrl}
            onChange={(e) => setConsoleUrl(e.target.value)}
            placeholder="https://www.dropbox.com/developers/apps"
            className="font-mono text-sm h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Setup hint (показывается пользователю)</Label>
          <Textarea
            value={setupHint}
            onChange={(e) => setSetupHint(e.target.value)}
            placeholder="Иди в Dropbox App Console → Create App → Permission type: Scoped access. Redirect URI: http://localhost:3210/api/oauth/callback."
            className="text-xs"
            rows={3}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsPKCE}
              onChange={(e) => setSupportsPKCE(e.target.checked)}
            />
            PKCE
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={refreshTokenSupported}
              onChange={(e) => setRefreshTokenSupported(e.target.checked)}
            />
            refresh_token
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={needsClientSecret}
              onChange={(e) => setNeedsClientSecret(e.target.checked)}
            />
            client_secret
          </label>
        </div>
        <div>
          <Label className="text-xs">Extra authorize params (JSON, optional)</Label>
          <Textarea
            value={extraParamsText}
            onChange={(e) => setExtraParamsText(e.target.value)}
            placeholder='{"access_type": "offline", "prompt": "consent"}'
            className="font-mono text-xs"
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || !id.trim() || !authorizeUrl.trim() || !tokenUrl.trim()}
          >
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Создать provider
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
