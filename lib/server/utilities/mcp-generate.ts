import "server-only";
import type { McpToolSpec } from "./mcp";

/**
 * Produce the manifest + source files for an MCP-bridge utility. The UI is
 * generated from the server's `tools/list` response: each tool becomes a
 * card with an auto-generated form for its `inputSchema`. Calls are routed
 * through `reflex.mcp.call({tool, args})` to the host, which reads the
 * server config from `<utility-dir>/mcp.json` and invokes the MCP server.
 */

export interface McpUtilitySpec {
  id: string;
  name: string;
  description: string;
  tools: McpToolSpec[];
}

export interface GeneratedMcpUtility {
  manifest: Record<string, unknown>;
  files: Record<string, string>;
}

export function generateMcpUtility(spec: McpUtilitySpec): GeneratedMcpUtility {
  const manifest = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    version: "0.1.0",
    ui: "ui.tsx",
    serverActions: [],
    permissions: {
      audit: { write: true },
    },
  };
  const ui = renderUiSource(spec);
  return {
    manifest,
    files: {
      "ui.tsx": ui,
      "README.md": renderReadme(spec),
    },
  };
}

function renderReadme(spec: McpUtilitySpec): string {
  const lines = [
    `# ${spec.name}`,
    "",
    `Reflex-обёртка над MCP-сервером. Tools (${spec.tools.length}):`,
    "",
    ...spec.tools.map(
      (t) => `- **${t.name}**${t.description ? ` — ${t.description}` : ""}`,
    ),
    "",
    "Конфиг сервера — в `mcp.json` рядом с этим файлом.",
    "",
  ];
  return lines.join("\n");
}

function renderUiSource(spec: McpUtilitySpec): string {
  const toolsLiteral = JSON.stringify(spec.tools, null, 2);
  return `import { useState } from "react";
import { reflex } from "@host/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  Badge,
} from "@host/ui";

interface Tool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

const TOOLS: Tool[] = ${toolsLiteral};

export default function McpBridge() {
  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">${escapeJs(spec.name)}</h1>
        ${spec.description ? `<p className="text-sm text-slate-600">${escapeJs(spec.description)}</p>` : ""}
        <Badge variant="outline">MCP · {TOOLS.length} tools</Badge>
      </header>
      {TOOLS.map((tool) => (
        <ToolCard key={tool.name} tool={tool} />
      ))}
    </div>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const properties = tool.inputSchema?.properties ?? {};
  const propertyNames = Object.keys(properties);
  const initial: Record<string, string> = {};
  for (const k of propertyNames) {
    const d = properties[k]?.default;
    initial[k] = d == null ? "" : typeof d === "string" ? d : JSON.stringify(d);
  }
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const args: Record<string, unknown> = {};
      for (const k of propertyNames) {
        const prop = properties[k];
        args[k] = coerceValue(values[k], prop);
      }
      const res = await reflex.mcp.call({ tool: tool.name, args });
      setResult(typeof res === "string" ? res : JSON.stringify(res, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="font-mono text-sm">{tool.name}</span>
        </CardTitle>
        {tool.description && (
          <p className="text-xs text-slate-600">{tool.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {propertyNames.length === 0 && (
            <p className="text-xs italic text-slate-500">No input parameters.</p>
          )}
          {propertyNames.map((k) => {
            const prop = properties[k];
            const t = primitiveType(prop);
            const isLong = t === "object" || t === "array";
            return (
              <div key={k} className="space-y-1">
                <Label className="flex items-center gap-2">
                  <span className="font-mono">{k}</span>
                  <span className="text-slate-400 text-[10px]">{describeType(prop)}</span>
                </Label>
                {prop?.description && (
                  <p className="text-xs text-slate-500">{prop.description}</p>
                )}
                {isLong ? (
                  <Textarea
                    value={values[k]}
                    onChange={(e) =>
                      setValues({ ...values, [k]: e.target.value })
                    }
                    placeholder={t === "array" ? "[]" : "{}"}
                  />
                ) : (
                  <Input
                    value={values[k]}
                    onChange={(e) =>
                      setValues({ ...values, [k]: e.target.value })
                    }
                    placeholder={t}
                  />
                )}
              </div>
            );
          })}
          <Button onClick={run} disabled={busy}>
            {busy ? "Выполняется…" : "Запустить"}
          </Button>
          {error && (
            <pre className="text-xs whitespace-pre-wrap text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </pre>
          )}
          {result && (
            <pre className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded p-2 max-h-72 overflow-auto">
              {result}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function primitiveType(prop?: JsonSchemaProperty): string {
  if (!prop) return "string";
  const t = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  return t ?? "string";
}

function describeType(prop?: JsonSchemaProperty): string {
  if (!prop) return "string";
  const t = primitiveType(prop);
  if (prop.enum) return t + " · " + prop.enum.map((e) => JSON.stringify(e)).join(" | ");
  return t;
}

function coerceValue(raw: string, prop?: JsonSchemaProperty): unknown {
  if (raw === "") return undefined;
  const t = primitiveType(prop);
  if (t === "number" || t === "integer") {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(\`expected number for \${prop ? "param" : "value"}\`);
    return n;
  }
  if (t === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("expected boolean (true/false)");
  }
  if (t === "object" || t === "array") {
    return JSON.parse(raw);
  }
  return raw;
}
`;
}

function escapeJs(s: string): string {
  return s.replace(/[\\"`]/g, "\\$&").replace(/\n/g, " ");
}
