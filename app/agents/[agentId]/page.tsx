import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getRoot } from "@/lib/registry";
import { agentManager } from "@/lib/server/agents/manager";
import { readEvents } from "@/lib/server/agents/events-log";
import { AgentEventStream } from "./_components/agent-event-stream";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = agentManager.get(agentId);
  if (!agent) notFound();
  const entry = await getRoot(agent.rootId);
  if (!entry) notFound();
  const allEvents = await readEvents(entry.path, agent.topicId);
  const events = allEvents.filter((e) => e.agentId === agent.id);
  const t = await getTranslations("app");

  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-3 flex items-start gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mt-0.5">
          <Link href={`/roots/${agent.rootId}/chat/${agent.topicId}`}>
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("agents.topicLink")}
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium truncate">{agent.label}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
            <Badge variant="outline" className="font-mono">
              {agent.role}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {agent.task}
            </Badge>
            <Badge variant="secondary" className="font-mono">
              {agent.harness} · {agent.model}
            </Badge>
            <span className="ml-auto font-mono">
              {new Date(agent.startedAt).toLocaleString()}
              {agent.endedAt &&
                ` → ${new Date(agent.endedAt).toLocaleTimeString()}`}
            </span>
          </div>
          {agent.parentId && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              parent:{" "}
              <Link
                href={`/agents/${agent.parentId}`}
                className="font-mono underline-offset-2 hover:underline"
              >
                {agent.parentId}
              </Link>
            </div>
          )}
        </div>
      </header>
      <Separator />
      <AgentEventStream
        agentId={agent.id}
        rootId={agent.rootId}
        topicId={agent.topicId}
        initialEvents={events}
      />
    </main>
  );
}

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "running" || status === "starting") return "default";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "secondary";
}
