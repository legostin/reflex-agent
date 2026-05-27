"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  FileSearch,
  FileText,
  Folder,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  input: unknown;
  result?: { content: string; isError?: boolean };
  pending?: boolean;
}

export function ToolCall({ name, input, result, pending }: Props) {
  const t = useTranslations("roots");
  const [open, setOpen] = useState(false);
  const Icon = pickIcon(name);
  const summary = pickSummary(name, input);
  return (
    <div
      className={cn(
        "rounded-lg border my-2 text-sm overflow-hidden",
        result?.isError
          ? "border-destructive/40 bg-destructive/5"
          : "bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-mono text-xs font-medium">{name}</span>
        {summary && (
          <span className="text-xs text-muted-foreground truncate">
            {summary}
          </span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
          {pending ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("toolCall.working")}
            </span>
          ) : result?.isError ? (
            <span className="text-destructive">{t("toolCall.error")}</span>
          ) : result ? (
            <span>{t("toolCall.done")}</span>
          ) : (
            <span>—</span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              input
            </div>
            <pre className="text-[11px] font-mono bg-background/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {formatInput(input)}
            </pre>
          </div>
          {result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                output
              </div>
              <pre
                className={cn(
                  "text-[11px] font-mono rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto",
                  result.isError
                    ? "bg-destructive/10 text-destructive-foreground"
                    : "bg-background/60",
                )}
              >
                {result.content || "(empty)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pickIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower === "read") return FileText;
  if (lower === "write" || lower === "edit") return Edit3;
  if (lower === "bash" || lower === "shell") return Terminal;
  if (lower === "glob") return FileSearch;
  if (lower === "grep" || lower === "search") return Search;
  if (lower === "ls") return Folder;
  return Wrench;
}

function pickSummary(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const lower = name.toLowerCase();
  if (lower === "read" || lower === "write" || lower === "edit") {
    if (typeof obj.file_path === "string") return obj.file_path;
  }
  if (lower === "bash") {
    if (typeof obj.command === "string")
      return obj.command.length > 80
        ? obj.command.slice(0, 77) + "…"
        : obj.command;
  }
  if (lower === "glob") {
    if (typeof obj.pattern === "string") return obj.pattern;
  }
  if (lower === "grep") {
    const parts: string[] = [];
    if (typeof obj.pattern === "string") parts.push(obj.pattern);
    if (typeof obj.path === "string") parts.push(`in ${obj.path}`);
    return parts.join(" ");
  }
  if (lower === "ls") {
    if (typeof obj.path === "string") return obj.path;
  }
  return "";
}

function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
