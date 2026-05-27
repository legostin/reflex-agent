"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { AgentEvent } from "@/lib/server/agents/types";

interface Props {
  agentId: string;
  rootId: string;
  topicId: string;
  initialEvents: AgentEvent[];
}

export function AgentEventStream({
  agentId,
  rootId,
  topicId,
  initialEvents,
}: Props) {
  const t = useTranslations("app");
  const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
  const lastSeq = useRef<number>(
    initialEvents.length > 0
      ? initialEvents[initialEvents.length - 1]!.seq
      : -1,
  );

  useEffect(() => {
    const ctrl = new AbortController();
    let stop = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/roots/${rootId}/chat/${topicId}/stream?since=${lastSeq.current}`,
          { signal: ctrl.signal },
        );
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (!stop) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (const evt of split(buf)) {
            buf = evt.rest;
            if (evt.event !== "event" || !evt.data) continue;
            const ev = evt.data as AgentEvent;
            if (ev.agentId !== agentId) continue;
            if (ev.seq <= lastSeq.current) continue;
            lastSeq.current = ev.seq;
            setEvents((cur) => [...cur, ev]);
          }
        }
      } catch {
        // disconnect; React will not auto-reconnect — user can refresh
      }
    })();
    return () => {
      stop = true;
      ctrl.abort();
    };
  }, [agentId, rootId, topicId]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-2">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("agents.noEvents")}
          </p>
        ) : (
          events.map((e) => <EventRow key={e.seq} event={e} />)
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const time = new Date(event.ts).toLocaleTimeString();
  if (event.type === "agent-start") {
    return (
      <Card>
        <Meta time={time} type="agent-start" />
        <p className="text-xs">
          {event.meta.role} · {event.meta.harness} · {event.meta.model}
        </p>
      </Card>
    );
  }
  if (event.type === "agent-end") {
    return (
      <Card>
        <Meta time={time} type={`agent-end (${event.status})`} />
        {event.error && (
          <p className="text-xs text-destructive">{event.error}</p>
        )}
      </Card>
    );
  }
  if (event.type === "turn-start") {
    return (
      <Card>
        <Meta time={time} type={`turn-start (${event.turnId})`} />
      </Card>
    );
  }
  if (event.type === "turn-end") {
    return (
      <Card>
        <Meta time={time} type={`turn-end (${event.status})`} />
        {event.error && (
          <p className="text-xs text-destructive">{event.error}</p>
        )}
      </Card>
    );
  }
  if (event.type === "user-message") {
    return (
      <Card>
        <Meta time={time} type="user-message" />
        <pre className="text-xs whitespace-pre-wrap">{event.text}</pre>
      </Card>
    );
  }
  if (event.type === "assistant-delta") {
    return (
      <Card>
        <Meta time={time} type="assistant-delta" />
        <pre className="text-xs whitespace-pre-wrap">{event.text}</pre>
      </Card>
    );
  }
  if (event.type === "tool-use") {
    return (
      <Card>
        <Meta time={time} type={`tool-use: ${event.name}`} />
        <pre className="text-[11px] whitespace-pre-wrap font-mono">
          {JSON.stringify(event.input, null, 2)}
        </pre>
      </Card>
    );
  }
  if (event.type === "tool-result") {
    return (
      <Card>
        <Meta time={time} type={`tool-result${event.isError ? " (error)" : ""}`} />
        <pre className="text-[11px] whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
          {event.content}
        </pre>
      </Card>
    );
  }
  if (event.type === "system") {
    return (
      <Card>
        <Meta time={time} type={`system: ${event.subtype ?? "system"}`} />
        <pre className="text-xs whitespace-pre-wrap">{event.text}</pre>
      </Card>
    );
  }
  if (event.type === "error") {
    return (
      <Card>
        <Meta time={time} type="error" />
        <pre className="text-xs text-destructive whitespace-pre-wrap">
          {event.message}
        </pre>
      </Card>
    );
  }
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border bg-muted/20 p-3">{children}</div>;
}

function Meta({ time, type }: { time: string; type: string }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-2">
      <span className="font-mono">{time}</span>
      <span>{type}</span>
    </div>
  );
}

interface Split {
  event: string;
  data: unknown;
  rest: string;
}
function split(buf: string): Split[] {
  const out: Split[] = [];
  while (true) {
    const idx = buf.indexOf("\n\n");
    if (idx < 0) break;
    const block = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    let event = "message";
    let dataLine = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        dataLine += line.slice(5).trimStart();
    }
    let data: unknown = null;
    try {
      data = dataLine ? JSON.parse(dataLine) : null;
    } catch {
      data = null;
    }
    out.push({ event, data, rest: buf });
  }
  return out;
}
