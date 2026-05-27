"use client";

import {
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  Hash,
  Pause,
  Tag,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Renders entity-specific frontmatter as small badges/chips above the body.
 * When `kind` is known (task | meeting | product | fact), the badges follow a
 * typed schema; for any other kind, we surface a generic key:value preview of
 * the remaining frontmatter keys.
 */
export function EntityBadges({
  kind,
  data,
}: {
  kind?: string;
  data: Record<string, unknown>;
}) {
  const lower = (kind ?? "").toLowerCase();
  if (lower === "task") return <TaskBadges data={data} />;
  if (lower === "meeting") return <MeetingBadges data={data} />;
  if (lower === "product") return <ProductBadges data={data} />;
  if (lower === "fact") return <FactBadges data={data} />;
  return <GenericMeta data={data} />;
}

const HIDE_KEYS = new Set(["title", "version", "date", "kind"]);

function GenericMeta({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => !HIDE_KEYS.has(k));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="outline" className="font-mono text-[10px]">
          <span className="text-muted-foreground mr-1">{k}:</span>
          <span className="truncate max-w-[16rem]">{stringify(v)}</span>
        </Badge>
      ))}
    </div>
  );
}

function TaskBadges({ data }: { data: Record<string, unknown> }) {
  const status = str(data.status);
  const priority = str(data.priority);
  const due = str(data.due) ?? str(data.due_date);
  const assignee = str(data.assignee);
  const tags = arr(data.tags);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status && (
        <Badge
          className={cn(
            "gap-1 capitalize",
            statusColor(status),
          )}
        >
          <StatusIcon status={status} />
          {status}
        </Badge>
      )}
      {priority && (
        <Badge
          variant="outline"
          className={cn("gap-1 capitalize", priorityColor(priority))}
        >
          <CircleDot className="h-3 w-3" />
          {priority}
        </Badge>
      )}
      {due && (
        <Badge variant="secondary" className="gap-1">
          <Calendar className="h-3 w-3" />
          до {due}
        </Badge>
      )}
      {assignee && (
        <Badge variant="outline" className="gap-1">
          <User className="h-3 w-3" />
          {assignee}
        </Badge>
      )}
      {tags?.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1">
          <Tag className="h-3 w-3" />
          {t}
        </Badge>
      ))}
    </div>
  );
}

function MeetingBadges({ data }: { data: Record<string, unknown> }) {
  const attendees = arr(data.attendees);
  const decisions = arr(data.decisions);
  const actionItems = arr(data.action_items) ?? arr(data.actionItems);
  return (
    <div className="space-y-2">
      {attendees && attendees.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {attendees.map((a) => (
            <Badge key={a} variant="outline" className="gap-1">
              <User className="h-3 w-3" /> {a}
            </Badge>
          ))}
        </div>
      )}
      {decisions && decisions.length > 0 && (
        <ListBlock title="Решения" items={decisions} />
      )}
      {actionItems && actionItems.length > 0 && (
        <ListBlock title="Action items" items={actionItems} />
      )}
    </div>
  );
}

function ProductBadges({ data }: { data: Record<string, unknown> }) {
  const sku = str(data.sku);
  const price = data.price;
  const currency = str(data.currency);
  const vendor = str(data.vendor);
  const url = str(data.url);
  const tags = arr(data.tags);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(price !== undefined && price !== null && price !== "") && (
        <Badge className="bg-emerald-600 text-white">
          {formatPrice(price)}
          {currency ? ` ${currency}` : ""}
        </Badge>
      )}
      {sku && (
        <Badge variant="outline" className="gap-1 font-mono">
          <Hash className="h-3 w-3" /> {sku}
        </Badge>
      )}
      {vendor && (
        <Badge variant="secondary" className="gap-1">
          {vendor}
        </Badge>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          открыть
        </a>
      )}
      {tags?.map((t) => (
        <Badge key={t} variant="outline" className="gap-1">
          <Tag className="h-3 w-3" /> {t}
        </Badge>
      ))}
    </div>
  );
}

function FactBadges({ data }: { data: Record<string, unknown> }) {
  const tags = arr(data.tags);
  const source = str(data.source);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags?.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1">
          <Tag className="h-3 w-3" /> {t}
        </Badge>
      ))}
      {source && (
        <Badge variant="outline" className="gap-1 max-w-[24rem]">
          <span className="text-muted-foreground">источник:</span>
          <span className="truncate">{source}</span>
        </Badge>
      )}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </div>
      <ul className="space-y-0.5 text-sm">
        {items.map((i, idx) => (
          <li key={idx} className="leading-snug">
            • {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const lower = status.toLowerCase();
  if (lower === "done") return <CheckCircle2 className="h-3 w-3" />;
  if (lower === "doing" || lower === "in_progress") return <Clock className="h-3 w-3" />;
  if (lower === "blocked" || lower === "cancelled") return <XCircle className="h-3 w-3" />;
  if (lower === "paused") return <Pause className="h-3 w-3" />;
  return <CircleDot className="h-3 w-3" />;
}

function statusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "done") return "bg-emerald-600 text-white";
  if (lower === "doing" || lower === "in_progress") return "bg-blue-600 text-white";
  if (lower === "blocked" || lower === "cancelled") return "bg-destructive text-destructive-foreground";
  if (lower === "paused") return "bg-amber-600 text-white";
  return "bg-secondary text-secondary-foreground";
}

function priorityColor(priority: string): string {
  const lower = priority.toLowerCase();
  if (lower === "high" || lower === "p0" || lower === "urgent")
    return "border-destructive text-destructive";
  if (lower === "med" || lower === "medium" || lower === "p1")
    return "border-amber-600 text-amber-700";
  return "border-muted-foreground text-muted-foreground";
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function arr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
    .filter((x) => x.trim());
  return out.length > 0 ? out : undefined;
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => stringify(x)).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatPrice(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "string") return v;
  return String(v);
}
