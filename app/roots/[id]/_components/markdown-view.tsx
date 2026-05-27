"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Check,
  KeyRound,
  Loader2,
  Save,
  Send,
  Sparkles,
  X,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveGeminiKeyAction,
  summarizeYoutubeAction,
} from "@/lib/server/youtube-actions";

/**
 * Renders KB / chat markdown with syntax-highlighted code blocks and
 * inline YouTube embeds. Each YouTube embed has a Gemini-backed Summarize
 * button that:
 *   1. Calls `summarizeYoutubeAction(url)` which uses Gemini's native
 *      multimodal YouTube URL support.
 *   2. If no Gemini key is saved, inline-prompts the user to paste one
 *      (mirroring the MCP-add secret-slot UX).
 *   3. Renders the summary text below the player; an optional
 *      `onSendToChat` callback lets the host (chat / KB viewer) inject the
 *      summary back into the conversation.
 */
export function MarkdownView({
  source,
  onSendToChat,
  autoSummarizeYoutube,
}: {
  source: string;
  /**
   * Called when the user clicks "Отправить в чат" on a generated summary.
   * Hosts can wire this to send the text as a user message in the current
   * topic, or start a new topic with the summary as context.
   */
  onSendToChat?: (text: string, url: string) => void;
  /**
   * If true, every YouTube embed in this render auto-triggers Gemini
   * summarization on mount. Used when the host detected an explicit
   * "summarize this" intent in the user's message.
   */
  autoSummarizeYoutube?: boolean;
}) {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  return (
    <div
      className={[
        "prose prose-neutral dark:prose-invert max-w-none",
        "[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-sm",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground",
        "[&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:text-[0.9em]",
        "[&_code]:font-mono [&_table]:text-sm",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={{
          a: ({ href, children, ...rest }) => {
            const id = href ? parseYoutubeId(href) : null;
            if (id && href) {
              return (
                <YouTubeEmbed
                  url={href}
                  videoId={id}
                  autoSummarize={autoSummarizeYoutube ?? false}
                  {...(onSendToChat ? { onSendToChat } : {})}
                />
              );
            }
            return (
              <a href={href} {...rest}>
                {children}
              </a>
            );
          },
          img: ({ src, alt, title }) => {
            if (typeof src !== "string" || src.length === 0) return null;
            return (
              <ZoomableImage
                src={src}
                alt={typeof alt === "string" ? alt : ""}
                title={typeof title === "string" ? title : undefined}
                onZoom={(payload) => setZoom(payload)}
              />
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
      {zoom && (
        <ImageLightbox
          src={zoom.src}
          alt={zoom.alt}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

/**
 * Inline image that opens a fullscreen lightbox on click. Plain
 * `<img>` would render fine on its own; the wrapper adds the click
 * affordance + a subtle hover state so users discover the zoom.
 */
function ZoomableImage({
  src,
  alt,
  title,
  onZoom,
}: {
  src: string;
  alt: string;
  title?: string;
  onZoom: (payload: { src: string; alt: string }) => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      title={title ?? alt ?? "Открыть на весь экран"}
      onClick={() => onZoom({ src, alt })}
      className="cursor-zoom-in rounded-md border bg-muted/40 transition hover:opacity-90"
      loading="lazy"
    />
  );
}

/**
 * Fullscreen overlay: dimmed background + image centered + Esc/click
 * to dismiss. Kept inline (no shared modal component) because there's
 * nothing else to share — a single src + onClose is the whole state.
 */
function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    // Prevent body scroll behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [handleKey]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-background/85 backdrop-blur-sm cursor-zoom-out"
      onClick={onClose}
      role="dialog"
      aria-label={alt || "Просмотр изображения"}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute top-4 right-4 h-9 w-9 bg-card/80 hover:bg-card"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Закрыть"
      >
        <X className="h-5 w-5" />
      </Button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {alt && (
        <div className="absolute bottom-6 inset-x-0 mx-auto max-w-3xl px-6 text-center text-sm text-foreground/80 pointer-events-none">
          {alt}
        </div>
      )}
    </div>
  );
}

function YouTubeEmbed({
  url,
  videoId,
  onSendToChat,
  autoSummarize,
}: {
  url: string;
  videoId: string;
  onSendToChat?: (text: string, url: string) => void;
  autoSummarize?: boolean;
}) {
  const [busy, start] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const autoFired = useRef(false);

  const summarize = () => {
    setSummary(null);
    start(async () => {
      const res = await summarizeYoutubeAction({ url });
      if (res.ok) {
        setSummary(res.text);
        setNeedsKey(false);
        return;
      }
      if (res.needsKey) {
        setNeedsKey(true);
        return;
      }
      toast.error(res.error);
    });
  };

  // Auto-fire when the host marks this embed as "intent detected" (e.g.
  // the user wrote "суммаризируй …" together with the link). Guarded by a
  // ref so React strict-mode / re-renders don't double-fire.
  useEffect(() => {
    if (!autoSummarize) return;
    if (autoFired.current) return;
    autoFired.current = true;
    summarize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSummarize]);

  const saveKey = async () => {
    if (!keyDraft.trim()) {
      toast.error("Введи ключ");
      return;
    }
    setSavingKey(true);
    try {
      const res = await saveGeminiKeyAction(keyDraft.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Gemini key сохранён");
      setKeyDraft("");
      setNeedsKey(false);
      summarize();
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <span className="not-prose my-4 block rounded-lg border bg-card overflow-hidden">
      <span className="relative block w-full" style={{ paddingTop: "56.25%" }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          title="YouTube video"
        />
      </span>
      <span className="flex items-center gap-2 p-2 border-t bg-muted/30">
        <Youtube className="h-4 w-4 text-red-600 shrink-0" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:underline truncate flex-1 min-w-0"
        >
          {url}
        </a>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={summarize}
          disabled={busy}
          className="gap-1 shrink-0 h-7"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Суммаризировать
        </Button>
      </span>

      {needsKey && (
        <span className="block border-t bg-amber-50/60 p-3 space-y-2">
          <span className="flex items-center gap-2 text-xs text-amber-900">
            <KeyRound className="h-3.5 w-3.5" />
            <span className="font-medium">Нужен Gemini API key</span>
          </span>
          <span className="block text-[11px] text-amber-900/80">
            Возьми ключ в{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              aistudio.google.com/apikey
            </a>
            {" "}— бесплатный tier (15 RPM / 1500 RPD). Сохранится в{" "}
            <code className="font-mono">~/.reflex/api-keys/gemini.json</code>{" "}
            (0600), агентам не передаётся. Модель подтянется автоматически из{" "}
            <code className="font-mono">models.list</code> (по умолчанию — самая быстрая flash);
            сменить можно в Settings → Gemini.
          </span>
          <span className="flex items-center gap-2">
            <Input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza…"
              className="font-mono text-xs h-8 flex-1"
              disabled={savingKey}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void saveKey()}
              disabled={savingKey || !keyDraft.trim()}
              className="h-8 gap-1"
            >
              {savingKey ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Сохранить и продолжить
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setNeedsKey(false)}
              className="h-8 w-8"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        </span>
      )}

      {summary && (
        <span className="block border-t p-3 space-y-2">
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Check className="h-3 w-3 text-emerald-600" />
            Gemini summary
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={summarize}
              className="ml-auto h-6 text-[10px] gap-1"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Переделать
            </Button>
            {onSendToChat && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSendToChat(summary, url)}
                className="h-6 text-[10px] gap-1"
              >
                <Send className="h-3 w-3" />
                В чат
              </Button>
            )}
          </span>
          <span className="block">
            <span className="block text-sm whitespace-pre-wrap leading-relaxed">
              {summary}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Extract a YouTube video id from common URL forms:
 *   youtu.be/<id>
 *   www.youtube.com/watch?v=<id>
 *   www.youtube.com/shorts/<id>
 *   www.youtube.com/embed/<id>
 *   m.youtube.com/...
 *   www.youtube-nocookie.com/embed/<id>
 */
function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v");
        return v && /^[A-Za-z0-9_-]{6,}$/.test(v) ? v : null;
      }
      const sub = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      if (sub && /^[A-Za-z0-9_-]{6,}$/.test(sub[2]!)) return sub[2]!;
    }
  } catch {
    // not a valid URL
  }
  return null;
}
