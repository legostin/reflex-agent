"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  mcpInstallAction,
  mcpPreviewAction,
  type McpPreviewActionResult,
} from "@/lib/server/utilities/actions";
import type { UtilityScope } from "@/lib/server/utilities/types";

type Transport = "stdio" | "http" | "sse";

interface Preview {
  serverName?: string;
  serverVersion?: string;
  tools: Array<{ name: string; description?: string }>;
}

/**
 * Wraps an MCP server (stdio subprocess or HTTP/SSE endpoint) as a Reflex
 * utility. The dialog connects to the server, lists its tools, and on
 * confirmation generates a utility whose UI is a form per tool.
 */
export function InstallFromMcpButton() {
  const [open, setOpen] = useState(false);
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<UtilityScope>("global");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, startPreview] = useTransition();
  const [installing, startInstall] = useTransition();
  const router = useRouter();

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
      } catch (e) {
        return { ok: false, error: "env must be JSON object" };
      }
    }
    if (!url.trim()) return { ok: false, error: "URL required" };
    try {
      const headers = headersText.trim() ? JSON.parse(headersText) : {};
      return {
        ok: true,
        config: {
          transport,
          url: url.trim(),
          headers,
        },
      };
    } catch {
      return { ok: false, error: "headers must be JSON object" };
    }
  };

  const handlePreview = () => {
    const built = buildConfig();
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    setPreview(null);
    startPreview(async () => {
      const res: McpPreviewActionResult = await mcpPreviewAction(built.config);
      if (!res.ok) {
        toast.error("Connect failed: " + res.error);
        return;
      }
      setPreview({
        ...(res.serverName ? { serverName: res.serverName } : {}),
        ...(res.serverVersion ? { serverVersion: res.serverVersion } : {}),
        tools: res.tools,
      });
      if (!id) {
        const slug = (res.serverName ?? "mcp-server")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40);
        setId(slug || "mcp-server");
      }
      if (!name) setName(res.serverName ?? "MCP server");
    });
  };

  const handleInstall = () => {
    const built = buildConfig();
    if (!built.ok) {
      toast.error(built.error);
      return;
    }
    if (!preview) {
      toast.error("preview first");
      return;
    }
    if (!id.trim() || !name.trim()) {
      toast.error("id and name required");
      return;
    }
    startInstall(async () => {
      const res = await mcpInstallAction({
        scope,
        id: id.trim(),
        name: name.trim(),
        config: built.config as never,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`installed ${res.id}`);
      setOpen(false);
      resetForm();
      router.refresh();
      router.push(`/utilities/${res.scope}/${res.id}`);
    });
  };

  const resetForm = () => {
    setCommand("");
    setArgs("");
    setEnvText("");
    setUrl("");
    setHeadersText("");
    setId("");
    setName("");
    setPreview(null);
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Plug className="h-4 w-4" />
        From MCP
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              MCP server → Reflex utility
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Подключимся к серверу, прочитаем tools/list, сгенерируем UI и server-action прокси.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Transport</Label>
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
                <Label>Command</Label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                />
              </div>
              <div>
                <Label>Args (space-separated)</Label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-everything"
                />
              </div>
              <div>
                <Label>Env (JSON, optional)</Label>
                <Textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder='{"FOO": "bar"}'
                  className="font-mono text-xs"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </div>
              <div>
                <Label>Headers (JSON, optional)</Label>
                <Textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder='{"Authorization": "Bearer ..."}'
                  className="font-mono text-xs"
                />
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button onClick={handlePreview} disabled={previewing}>
              {previewing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Connecting…
                </>
              ) : (
                "Connect & list tools"
              )}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3 border-t pt-4">
              <div className="text-sm">
                <span className="font-medium">Server:</span>{" "}
                {preview.serverName ?? "(anonymous)"}
                {preview.serverVersion ? ` v${preview.serverVersion}` : ""}
                <Badge variant="outline" className="ml-2">
                  {preview.tools.length} tools
                </Badge>
              </div>
              <div className="max-h-40 overflow-y-auto rounded border bg-slate-50 p-2 text-xs">
                {preview.tools.length === 0 ? (
                  <em className="text-slate-500">No tools advertised.</em>
                ) : (
                  <ul className="space-y-1">
                    {preview.tools.map((t) => (
                      <li key={t.name}>
                        <span className="font-mono">{t.name}</span>
                        {t.description && (
                          <span className="text-slate-500"> — {t.description}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Utility id (kebab-case)</Label>
                  <Input
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    placeholder="my-mcp-server"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label>Display name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My MCP Server"
                  />
                </div>
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as UtilityScope)}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">global (~/.reflex)</SelectItem>
                    <SelectItem value="project">project</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  Отмена
                </Button>
                <Button onClick={handleInstall} disabled={installing}>
                  {installing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Installing…
                    </>
                  ) : (
                    "Install"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
