"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Loader2,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMcpServerAction,
  listMcpServersAction,
  removeMcpServerAction,
  startMcpSetupAction,
  testMcpServerAction,
} from "@/lib/server/mcp-actions";
import type { McpServerEntry } from "@/lib/server/mcp-registry";

type Transport = "stdio" | "http" | "sse";

/**
 * Registry-wide MCP servers. Utilities reference them by id via
 * `manifest.mcpServers`; the chat orchestrator gets them all wired through
 * its CLI harness's `--mcp-config`.
 */
export function McpServersSection() {
  const t = useTranslations("settings");
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, startLoad] = useTransition();
  const [adding, setAdding] = useState(false);
  const [wizardPrompt, setWizardPrompt] = useState("");
  const [wizardLoading, startWizard] = useTransition();
  const router = useRouter();

  const runWizard = () => {
    const text = wizardPrompt.trim();
    if (!text) {
      toast.error(t("mcpServers.wizardDescribeError"));
      return;
    }
    startWizard(async () => {
      const res = await startMcpSetupAction(text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("mcpServers.wizardOpenedToast"));
      setWizardPrompt("");
      router.push(`/roots/${res.rootId}/chat/${res.topicId}`);
    });
  };

  const reload = () => {
    startLoad(async () => {
      const res = await listMcpServersAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setServers(res.servers);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: string) => {
    if (!confirm(t("mcpServers.removeConfirm", { id }))) return;
    const res = await removeMcpServerAction(id);
    if (!res.ok) {
      toast.error(res.error ?? "fail");
      return;
    }
    toast.success(t("mcpServers.removedToast"));
    reload();
  };

  return (
    <div className="space-y-3">
      <Card className="reflex-gradient p-[2px]">
        <div className="rounded-[7px] bg-background/95 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4" />
            <span>{t("mcpServers.wizardTitle")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("mcpServers.wizardDescription")}
          </p>
          <div className="flex gap-2">
            <Input
              value={wizardPrompt}
              onChange={(e) => setWizardPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runWizard();
                }
              }}
              placeholder={t("mcpServers.wizardPlaceholder")}
              disabled={wizardLoading}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={runWizard}
              disabled={wizardLoading || !wizardPrompt.trim()}
              className="gap-2"
            >
              {wizardLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("mcpServers.wizardRun")}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("mcpServers.wizardFooter")}
          </p>
        </div>
      </Card>

      {loading && servers.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> {t("mcpServers.loading")}
          </CardContent>
        </Card>
      ) : servers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground text-center">
            {t.rich("mcpServers.emptyHint", {
              code: (chunks) => <code>{chunks}</code>,
            })}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <Card key={s.id}>
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <Plug className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{s.id}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {s.config.transport}
                    </Badge>
                    <span className="text-sm text-muted-foreground truncate">
                      {s.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {s.config.transport === "stdio"
                      ? `${s.config.command} ${(s.config.args ?? []).join(" ")}`
                      : s.config.url}
                  </div>
                  {s.description && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {s.description}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => void remove(s.id)}
                  title={t("mcpServers.removeTitle")}
                  className="h-8 w-8"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <AddServerForm
          existingIds={servers.map((s) => s.id)}
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
          {t("mcpServers.addManual")}
        </Button>
      )}
    </div>
  );
}

function AddServerForm({
  existingIds,
  onCancel,
  onAdded,
}: {
  existingIds: string[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const t = useTranslations("settings");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [tested, setTested] = useState<{
    serverName?: string;
    toolsCount: number;
  } | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();

  const buildConfig = ():
    | { ok: true; config: unknown }
    | { ok: false; error: string } => {
    if (transport === "stdio") {
      if (!command.trim()) return { ok: false, error: "command required" };
      try {
        const env = envText.trim() ? JSON.parse(envText) : {};
        return {
          ok: true,
          config: {
            transport: "stdio",
            command: command.trim(),
            args: args.trim()
              ? args.trim().split(/\s+/).filter(Boolean)
              : [],
            env,
          },
        };
      } catch {
        return { ok: false, error: "env must be JSON object" };
      }
    }
    if (!url.trim()) return { ok: false, error: "URL required" };
    try {
      const headers = headersText.trim() ? JSON.parse(headersText) : {};
      return {
        ok: true,
        config: { transport, url: url.trim(), headers },
      };
    } catch {
      return { ok: false, error: "headers must be JSON object" };
    }
  };

  const test = () => {
    const built = buildConfig();
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    setTested(null);
    startTest(async () => {
      const res = await testMcpServerAction(built.config);
      if (!res.ok) {
        toast.error("Connect failed: " + res.error);
        return;
      }
      setTested({
        ...(res.serverName ? { serverName: res.serverName } : {}),
        toolsCount: res.tools.length,
      });
      if (!label) setLabel(res.serverName ?? id);
    });
  };

  const save = () => {
    const slug = id.trim().toLowerCase();
    if (!slug) {
      toast.error("id required");
      return;
    }
    if (existingIds.includes(slug)) {
      toast.error(`id "${slug}" already used`);
      return;
    }
    if (!label.trim()) {
      toast.error("label required");
      return;
    }
    const built = buildConfig();
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    startSave(async () => {
      const res = await addMcpServerAction({
        id: slug,
        label: label.trim(),
        description: description.trim(),
        config: built.config,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("mcpServers.form.addedToast", { id: slug }));
      onAdded();
    });
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Plug className="h-4 w-4" /> {t("mcpServers.form.title")}
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">ID (kebab-case)</Label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="github"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="GitHub"
              className="text-sm"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">{t("mcpServers.form.descriptionLabel")}</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("mcpServers.form.descriptionPlaceholder")}
            className="text-sm"
          />
        </div>

        <div>
          <Label className="text-xs">Transport</Label>
          <Select value={transport} onValueChange={(v) => setTransport(v as Transport)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio (subprocess)</SelectItem>
              <SelectItem value="http">HTTP (Streamable)</SelectItem>
              <SelectItem value="sse">SSE (legacy)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {transport === "stdio" ? (
          <>
            <div>
              <Label className="text-xs">Command</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Args</Label>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-github"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Env (JSON, optional)</Label>
              <Textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder='{"GITHUB_TOKEN": "ghp_…"}'
                className="font-mono text-xs"
                rows={3}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Headers (JSON, optional)</Label>
              <Textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder='{"Authorization": "Bearer …"}'
                className="font-mono text-xs"
                rows={3}
              />
            </div>
          </>
        )}

        {tested && (
          <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs flex items-center gap-2 text-emerald-900">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              {t.rich("mcpServers.form.connectedTo", {
                mono: (chunks) => <span className="font-mono">{chunks}</span>,
                name: tested.serverName ?? t("mcpServers.form.anonymousName"),
                count: tested.toolsCount,
              })}
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={test}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("mcpServers.form.testButton")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saving || !tested}
          >
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("mcpServers.form.saveButton")}
          </Button>
        </div>
        {!tested && (
          <p className="text-[11px] text-muted-foreground">
            {t("mcpServers.form.testFirstHint")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
