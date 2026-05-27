"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ExternalLink,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  getOrCreateUtilityHelperTopicAction,
  loadHelperTranscriptAction,
  type HelperTranscriptMessage,
} from "@/lib/server/topic-actions";

interface Props {
  scope: "global" | "project";
  utilityId: string;
  utilityName?: string;
  rootId?: string;
  /** Imperative way to ask the iframe for fresh state. Resolves with
   *  whatever the utility chose to expose (or undefined if no listener). */
  requestSnapshot: () => Promise<unknown>;
  onClose?: () => void;
}

/**
 * Compact chat panel embedded next to the utility iframe. Backed by a
 * **real topic** flagged `helperFor: <utilityId>` — same conversation
 * persists between sessions, same `/send` + `/stream` endpoints as the
 * full chat view, just a slimmer UI focused on text turns. Reflex
 * protocol markers (`<<reflex:dispatch>>`, etc.) are stripped so the
 * user only sees the user-facing assistant text.
 *
 * Snapshot from the iframe is prepended to each outbound message as a
 * fenced context block — the agent sees it, the user sees it too (in
 * their own bubble) which is acceptable for v1; later we can route it
 * through a system-prompt extra-context channel.
 */
export function UtilityChatSidebar({
  scope,
  utilityId,
  utilityName,
  rootId,
  requestSnapshot,
  onClose,
}: Props) {
  const [topicId, setTopicId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelperTranscriptMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [bootError, setBootError] = useState<string | null>(null);
  const [pending, startSend] = useTransition();
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const liveAssistantRef = useRef<string>("");
  const [liveAssistant, setLiveAssistant] = useState<string>("");

  // Bootstrap: resolve / create the helper topic for this utility.
  useEffect(() => {
    if (!rootId) {
      setBootError("Чат доступен только в project-scope утилитах.");
      return;
    }
    let cancelled = false;
    void (async () => {
      const r = await getOrCreateUtilityHelperTopicAction({
        rootId,
        utilityId,
        utilityName: utilityName ?? utilityId,
      });
      if (cancelled) return;
      if (!r.ok) {
        setBootError(r.error);
        return;
      }
      setTopicId(r.topicId);
      const t = await loadHelperTranscriptAction(rootId, r.topicId);
      if (cancelled) return;
      if (t.ok) setMessages(t.messages);
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, utilityId, utilityName]);

  // SSE subscription — fires whenever the topic gets new events.
  useEffect(() => {
    if (!rootId || !topicId) return;
    // since=Number.MAX_SAFE_INTEGER skips replay — transcript was just
    // loaded synchronously above; live events from `subscribeTopic` flow
    // unchanged. Tiny race window if the agent finished a turn between
    // the two calls is covered by the turn-end transcript reload below.
    const es = new EventSource(
      `/api/roots/${rootId}/chat/${topicId}/stream?since=${Number.MAX_SAFE_INTEGER}`,
    );
    sseRef.current = es;
    es.addEventListener("event", (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type?: string;
          text?: string;
        };
        if (data.type === "assistant-delta" && typeof data.text === "string") {
          liveAssistantRef.current += data.text;
          setLiveAssistant(liveAssistantRef.current);
          setStreaming(true);
        } else if (data.type === "turn-end" || data.type === "agent-end") {
          // Final text persists — reload transcript and clear live buffer.
          liveAssistantRef.current = "";
          setLiveAssistant("");
          setStreaming(false);
          void (async () => {
            const t = await loadHelperTranscriptAction(rootId, topicId);
            if (t.ok) setMessages(t.messages);
          })();
        } else if (data.type === "user-message") {
          // Already optimistically rendered; transcript refresh after
          // the assistant finishes keeps order honest.
        }
      } catch {
        /* ignore malformed */
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [rootId, topicId]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveAssistant]);

  const send = () => {
    const text = draft.trim();
    if (!text || !rootId || !topicId) return;
    setDraft("");
    // Optimistic add — final reload after stream end will normalize.
    setMessages((cur) => [
      ...cur,
      { role: "user", text, ts: new Date().toISOString() },
    ]);
    startSend(async () => {
      let snapshot: unknown = undefined;
      try {
        snapshot = await Promise.race([
          requestSnapshot(),
          new Promise((resolve) => setTimeout(() => resolve(undefined), 600)),
        ]);
      } catch {
        /* no snapshot */
      }
      const messageWithContext =
        snapshot !== undefined
          ? buildPromptWithSnapshot(text, snapshot)
          : text;
      try {
        const res = await fetch(
          `/api/roots/${rootId}/chat/${topicId}/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: messageWithContext }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(body.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        toast.error(String(err));
      }
    });
  };

  return (
    <aside className="flex h-full flex-col border-l bg-card">
      <header className="border-b px-3 py-2 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
        <span className="text-sm font-medium">Помощник</span>
        <span className="text-[10px] text-muted-foreground ml-1">
          знает контекст этого приложения
        </span>
        {rootId && topicId && (
          <Link
            href={`/roots/${rootId}/chat/${topicId}`}
            className="ml-auto p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Открыть в полном чате"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={
              "p-1 rounded hover:bg-accent " +
              (rootId && topicId ? "" : "ml-auto")
            }
            title="Скрыть"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-sm"
      >
        {bootError && (
          <p className="text-xs text-red-600">{bootError}</p>
        )}
        {!bootError && messages.length === 0 && !liveAssistant && (
          <div className="text-xs text-muted-foreground flex items-start gap-2">
            <Sparkles className="h-3 w-3 mt-0.5 text-violet-600 shrink-0" />
            <span>
              Спроси что-нибудь про данные этого мини-приложения. Диалог
              сохраняется как обычный разговор — можно открыть полностью по
              иконке в углу.
            </span>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {streaming && liveAssistant && (
          <Bubble role="assistant" text={liveAssistant} streaming />
        )}
        {pending && !streaming && (
          <div className="mr-6 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reflex думает…
          </div>
        )}
      </div>
      <div className="border-t px-3 py-2 flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Спроси (⌘↵)…"
          disabled={pending || !!bootError || !topicId}
          className="flex-1 resize-none rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400 max-h-24"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !draft.trim() || !!bootError || !topicId}
          className="inline-flex items-center justify-center rounded bg-violet-600 px-2 py-1 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
      </div>
    </aside>
  );
}

function Bubble({
  role,
  text,
  streaming,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}) {
  // Strip a "[Контекст мини-приложения]…[/контекст]" fenced prelude from
  // the user's own bubble so the user doesn't see their own JSON dump.
  let display = text;
  if (role === "user") {
    display = display
      .replace(
        /^\s*\[Контекст мини-приложения\][\s\S]*?\[\/контекст\]\s*/,
        "",
      )
      .trim();
  }
  if (!display.trim()) return null;
  return (
    <div
      className={
        role === "user"
          ? "ml-6 rounded-md bg-violet-50 dark:bg-violet-950/30 px-2 py-1.5"
          : "mr-6 rounded-md bg-muted/40 px-2 py-1.5 whitespace-pre-wrap"
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {role === "user" ? "Ты" : role === "assistant" ? "Reflex" : "Система"}
        {streaming && <span className="ml-1 text-violet-600">●</span>}
      </div>
      {display}
    </div>
  );
}

function buildPromptWithSnapshot(prompt: string, snapshot: unknown): string {
  let snapText: string;
  try {
    snapText =
      typeof snapshot === "string"
        ? snapshot
        : JSON.stringify(snapshot, null, 2);
  } catch {
    snapText = String(snapshot);
  }
  if (snapText.length > 4000) {
    snapText = snapText.slice(0, 4000) + "\n…[truncated]";
  }
  return [
    "[Контекст мини-приложения]",
    snapText,
    "[/контекст]",
    "",
    prompt,
  ].join("\n");
}
