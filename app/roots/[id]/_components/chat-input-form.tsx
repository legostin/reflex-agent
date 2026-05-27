"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertOctagon,
  BookmarkPlus,
  BookOpen,
  Boxes,
  FileImage,
  FileText,
  HelpCircle,
  LayoutGrid,
  ListChecks,
  Loader2,
  PackagePlus,
  Paperclip,
  Sparkles,
  Square,
  Target,
  Telescope,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  searchMentionsAction,
  type MentionItem,
} from "./mention-actions";
import {
  COMMANDS,
  detectCommand,
  type CommandDef,
} from "@/lib/server/agents/commands-registry";
import {
  clearProjectAction,
  deleteCurrentTopicCommand,
  openUtilityAction,
  rememberAction,
} from "@/lib/server/chat-commands";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ListChecks,
  Target,
  Telescope,
  LayoutGrid,
  BookmarkPlus,
  PackagePlus,
  Sparkles,
  Trash2,
  AlertOctagon,
  HelpCircle,
  Workflow,
  Boxes,
};

export interface ChatAttachment {
  name: string;
  absPath: string;
  size: number;
  mime: string;
}

export interface ChatInputPayload {
  message: string;
  attachments: ChatAttachment[];
}

interface Props {
  rootId: string;
  /** Topic id when used inside a chat — enables /delete-topic. */
  topicId?: string;
  placeholder: string;
  submitLabel: string;
  pendingLabel: string;
  SubmitIcon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  onSubmit: (payload: ChatInputPayload) => Promise<boolean>;
  /**
   * When the topic has a running agent, the submit button flips to "Стоп"
   * (empty input) or "Уточнить" (non-empty input). "Уточнить" calls
   * `onClarify` first to stop the current turn, then `onSubmit` to start a
   * new one with the user's interjection.
   */
  active?: boolean;
  onStop?: () => Promise<void>;
  clarifyLabel?: string;
  stopLabel?: string;
}

const MAX_HEIGHT = 240;

export function ChatInputForm({
  rootId,
  topicId,
  placeholder,
  submitLabel,
  pendingLabel,
  SubmitIcon,
  disabled,
  onSubmit,
  active,
  onStop,
  clarifyLabel = "Уточнить",
  stopLabel = "Стоп",
}: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // @-mention picker state
  const [mentionRange, setMentionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  const mentionRequestId = useRef(0);

  // /-command palette state — only opens when the input *starts* with `/`
  // and the user is still typing the trigger (no space yet).
  const [commandPalette, setCommandPalette] = useState<{
    items: CommandDef[];
    index: number;
  } | null>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + "px";
  }, []);

  useEffect(() => {
    resize();
  }, [text, resize]);

  /** Detect whether the caret is currently inside an @-mention token and, if
   *  so, fetch matching items for the popover. */
  const evaluateMention = useCallback(
    (value: string, caret: number) => {
      // Walk back from caret until whitespace or @.
      let start = caret;
      while (start > 0) {
        const ch = value[start - 1]!;
        if (ch === "@") {
          start -= 1;
          break;
        }
        if (/\s/.test(ch)) {
          start = -1;
          break;
        }
        start -= 1;
      }
      if (start < 0 || value[start] !== "@") {
        setMentionRange(null);
        setMentionItems([]);
        return;
      }
      // Require @ to start the token (BOF or preceded by whitespace).
      if (start > 0 && !/\s/.test(value[start - 1]!)) {
        setMentionRange(null);
        setMentionItems([]);
        return;
      }
      const query = value.slice(start + 1, caret);
      setMentionRange({ start, end: caret });
      setMentionIndex(0);
      setMentionLoading(true);
      const reqId = ++mentionRequestId.current;
      void (async () => {
        const res = await searchMentionsAction(rootId, query);
        if (mentionRequestId.current !== reqId) return;
        setMentionLoading(false);
        setMentionItems(res.ok ? res.items : []);
      })();
    },
    [rootId],
  );

  const closeMention = useCallback(() => {
    setMentionRange(null);
    setMentionItems([]);
    mentionRequestId.current++;
  }, []);

  /**
   * Decide whether the `/` palette should be open for the current draft.
   * Opens when the input starts with `/` and the user hasn't typed a
   * space yet (after which they're typing the command's payload).
   * Filtering: simple prefix match against `trigger`.
   */
  const evaluateCommand = useCallback(
    (value: string) => {
      if (!value.startsWith("/")) {
        setCommandPalette(null);
        return;
      }
      // Once a space appears we're past the command word — close palette.
      const firstSpace = value.indexOf(" ");
      if (firstSpace >= 0) {
        setCommandPalette(null);
        return;
      }
      const query = value.slice(1).toLowerCase();
      const items = COMMANDS.filter((c) =>
        c.trigger.startsWith(query) ||
        c.label.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query),
      );
      if (items.length === 0) {
        setCommandPalette(null);
        return;
      }
      setCommandPalette({ items, index: 0 });
    },
    [],
  );

  const closeCommand = useCallback(() => setCommandPalette(null), []);

  const insertCommand = useCallback(
    (cmd: CommandDef) => {
      const ta = textareaRef.current;
      // `/cmd ` — append a space so the user can immediately start typing
      // the payload. For commands that don't accept payload (allowEmpty),
      // it's still ergonomic.
      const next = `/${cmd.trigger}${cmd.allowEmpty && cmd.kind === "direct" ? "" : " "}`;
      setText(next);
      setCommandPalette(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
      });
    },
    [],
  );

  const insertMention = useCallback(
    (item: MentionItem) => {
      const ta = textareaRef.current;
      if (!ta || !mentionRange) return;
      const before = text.slice(0, mentionRange.start);
      const after = text.slice(mentionRange.end);
      const insert = `@${item.relPath} `;
      const next = before + insert + after;
      setText(next);
      closeMention();
      const newPos = before.length + insert.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newPos, newPos);
      });
    },
    [text, mentionRange, closeMention],
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const form = new FormData();
        for (const f of files) form.append("files", f);
        const res = await fetch(`/api/roots/${rootId}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(body.error ?? `Не удалось загрузить (${res.status})`);
          return;
        }
        const data = (await res.json()) as {
          ok: boolean;
          files: ChatAttachment[];
        };
        setAttachments((cur) => [...cur, ...data.files]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [rootId],
  );

  const hasInput = text.trim().length > 0 || attachments.length > 0;
  const mode: "send" | "stop" | "clarify" = active && onStop
    ? hasInput
      ? "clarify"
      : "stop"
    : "send";

  const submit = useCallback(async () => {
    if (pending) return;
    if (mode === "stop") {
      if (!onStop) return;
      setPending(true);
      try {
        await onStop();
      } finally {
        setPending(false);
      }
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (disabled && mode === "send") return;

    // Intercept direct-action commands before they hit the topic-send
    // path. These never start an agent turn — they're file mutations
    // or pure UI side-effects.
    const cmd = detectCommand(trimmed);
    if (cmd && cmd.def.kind === "direct") {
      setPending(true);
      try {
        await runDirectCommand({
          cmd: cmd.def,
          payload: cmd.payload,
          rootId,
          topicId,
          router,
        });
        setText("");
      } finally {
        setPending(false);
      }
      return;
    }

    setPending(true);
    try {
      // "Уточнить" first interrupts the running turn so the send endpoint
      // doesn't 409. We don't clear the input until the new turn is accepted.
      if (mode === "clarify" && onStop) {
        await onStop();
      }
      const ok = await onSubmit({ message: trimmed, attachments });
      if (ok) {
        setText("");
        setAttachments([]);
      }
    } finally {
      setPending(false);
    }
  }, [
    text,
    attachments,
    pending,
    disabled,
    mode,
    onStop,
    onSubmit,
    rootId,
    topicId,
    router,
  ]);

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submit();
  };

  const canSend =
    !pending &&
    !uploading &&
    (mode === "stop"
      ? true
      : hasInput && (!disabled || mode === "clarify"));

  return (
    <form
      onSubmit={onFormSubmit}
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) void upload(files);
      }}
      className={cn(
        "space-y-2 rounded-md transition-colors",
        dragOver && "ring-2 ring-ring/60 bg-accent/40",
      )}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <AttachmentChip
              key={a.absPath + i}
              attachment={a}
              onRemove={() =>
                setAttachments((cur) => cur.filter((x) => x !== a))
              }
            />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              evaluateMention(e.target.value, e.target.selectionStart);
              evaluateCommand(e.target.value);
            }}
            onKeyUp={(e) => {
              const target = e.currentTarget;
              evaluateMention(target.value, target.selectionStart);
              evaluateCommand(target.value);
            }}
            onClick={(e) => {
              const target = e.currentTarget;
              evaluateMention(target.value, target.selectionStart);
              evaluateCommand(target.value);
            }}
            onBlur={() => {
              // Delay so click on a picker row registers first.
              setTimeout(() => {
                closeMention();
                closeCommand();
              }, 150);
            }}
            onKeyDown={(e) => {
              if (commandPalette) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCommandPalette((cur) =>
                    cur
                      ? {
                          ...cur,
                          index: Math.min(cur.items.length - 1, cur.index + 1),
                        }
                      : null,
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCommandPalette((cur) =>
                    cur ? { ...cur, index: Math.max(0, cur.index - 1) } : null,
                  );
                  return;
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const item = commandPalette.items[commandPalette.index];
                  if (item) insertCommand(item);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeCommand();
                  return;
                }
              }
              if (mentionRange && mentionItems.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) =>
                    Math.min(mentionItems.length - 1, i + 1),
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const item = mentionItems[mentionIndex];
                  if (item) insertMention(item);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeMention();
                  return;
                }
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                void upload(files);
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={disabled || pending}
            className="resize-none min-h-[44px] max-h-60 text-base bg-background/70 border-transparent focus-visible:border-ring py-2.5 w-full"
          />
          {mentionRange && (
            <MentionPicker
              items={mentionItems}
              index={mentionIndex}
              loading={mentionLoading}
              onPick={insertMention}
              onHover={(i) => setMentionIndex(i)}
            />
          )}
          {commandPalette && !mentionRange && (
            <CommandPalette
              items={commandPalette.items}
              index={commandPalette.index}
              onPick={insertCommand}
              onHover={(i) =>
                setCommandPalette((cur) => (cur ? { ...cur, index: i } : null))
              }
              topicAvailable={!!topicId}
            />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void upload(files);
            // Reset so re-selecting the same file fires onChange.
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || pending || disabled}
          title="Прикрепить файлы (можно drag&drop или Cmd+V)"
          className="h-11 w-11 shrink-0"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="submit"
          size="lg"
          disabled={!canSend}
          variant={mode === "stop" ? "destructive" : "default"}
          className="h-11 px-6 shadow-md shrink-0"
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {pendingLabel}
            </>
          ) : mode === "stop" ? (
            <>
              <Square className="mr-2 h-4 w-4" fill="currentColor" />
              {stopLabel}
            </>
          ) : mode === "clarify" ? (
            <>
              <SubmitIcon className="mr-2 h-4 w-4" />
              {clarifyLabel}
            </>
          ) : (
            <>
              <SubmitIcon className="mr-2 h-4 w-4" />
              {submitLabel}
            </>
          )}
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Enter — отправить · Shift+Enter — новая строка · @ — упомянуть файл/заметку · `/` — команды · можно перетащить файлы или вставить из буфера
      </div>
    </form>
  );
}

/**
 * Run a direct (non-agent) command. Surfaces toasts on success/failure
 * and handles navigation when the command implies one (e.g. clear-project
 * bounces to the dashboard).
 */
async function runDirectCommand({
  cmd,
  payload,
  rootId,
  topicId,
  router,
}: {
  cmd: CommandDef;
  payload: string;
  rootId: string;
  topicId?: string;
  router: ReturnType<typeof useRouter>;
}): Promise<void> {
  if (cmd.id === "help") {
    const lines = COMMANDS.map((c) => `• ${c.label} — ${c.description}`);
    toast.info(`Доступные команды:\n${lines.join("\n")}`, { duration: 12_000 });
    return;
  }
  if (cmd.id === "remember") {
    if (!payload) {
      toast.error("Пусто — нечего запоминать. Использование: /remember <текст>");
      return;
    }
    const r = await rememberAction(rootId, payload);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success(r.message ?? "Сохранено в KB");
      dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
    }
    return;
  }
  if (cmd.id === "delete-topic") {
    if (!topicId) {
      toast.error("Команда работает только внутри топика.");
      return;
    }
    if (!confirm("Удалить этот топик? Это необратимо.")) return;
    const r = await deleteCurrentTopicCommand(rootId, topicId);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success(r.message ?? "Удалено");
      dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
      if (r.redirectTo) router.push(r.redirectTo);
    }
    return;
  }
  if (cmd.id === "util") {
    const r = await openUtilityAction(rootId, payload);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    if (r.kind === "redirect") {
      router.push(r.url);
      return;
    }
    // Multiple matches → show a toast picker with clickable links.
    const list = r.items
      .slice(0, 8)
      .map((it) => `• ${it.name} (${it.scope}/${it.id})`)
      .join("\n");
    toast.message(`Несколько подходит — уточни запрос:\n${list}`, {
      duration: 12_000,
    });
    return;
  }
  if (cmd.id === "clear-project") {
    if (
      !confirm(
        "ВНИМАНИЕ: будут удалены ВСЕ топики, виджеты и KB-файлы этого проекта. Это необратимо. Продолжить?",
      )
    )
      return;
    const phrase = prompt(
      "Введи фразу «очистить» (без кавычек), чтобы подтвердить:",
    );
    if (phrase?.trim().toLowerCase() !== "очистить") {
      toast.message("Подтверждение не прошло — отмена.");
      return;
    }
    const r = await clearProjectAction(rootId);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success(r.message ?? "Проект очищен");
      dispatchReflex(REFLEX_EVENTS.topicsChanged(rootId));
      dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
      if (r.redirectTo) router.push(r.redirectTo);
    }
    return;
  }
  toast.error(`Неизвестная команда: ${cmd.label}`);
}

function CommandPalette({
  items,
  index,
  onPick,
  onHover,
  topicAvailable,
}: {
  items: CommandDef[];
  index: number;
  onPick: (cmd: CommandDef) => void;
  onHover: (i: number) => void;
  topicAvailable: boolean;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-80 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b">
        Команды · Tab — вставить · ↑↓ — выбор · Esc — закрыть
      </div>
      <ul>
        {items.map((cmd, i) => {
          const Icon = ICONS[cmd.icon] ?? Sparkles;
          const disabled = cmd.id === "delete-topic" && !topicAvailable;
          return (
            <li key={cmd.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (disabled) return;
                  onPick(cmd);
                }}
                onMouseEnter={() => onHover(i)}
                disabled={disabled}
                className={cn(
                  "w-full flex items-start gap-2 px-3 py-2 text-left",
                  i === index ? "bg-accent" : "hover:bg-accent/60",
                  disabled && "opacity-40 cursor-not-allowed",
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 mt-0.5 shrink-0",
                    cmd.kind === "direct" ? "text-amber-600" : "text-violet-600",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-xs font-medium">
                      {cmd.label}
                    </span>
                    {cmd.kind === "direct" && (
                      <span className="text-[9px] uppercase tracking-wider text-amber-700">
                        прямое действие
                      </span>
                    )}
                    {cmd.requiresConfirm && (
                      <span className="text-[9px] uppercase tracking-wider text-destructive">
                        с подтверждением
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {cmd.description}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 font-mono mt-0.5">
                    {cmd.usage}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MentionPicker({
  items,
  index,
  loading,
  onPick,
  onHover,
}: {
  items: MentionItem[];
  index: number;
  loading: boolean;
  onPick: (item: MentionItem) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
      {loading && items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> поиск…
        </div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground italic">
          ничего не найдено
        </div>
      ) : (
        <ul>
          {items.map((item, i) => {
            const Icon = item.kind === "kb" ? BookOpen : FileText;
            return (
              <li key={item.absPath}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(item);
                  }}
                  onMouseEnter={() => onHover(i)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left",
                    i === index ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      item.kind === "kb"
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">
                      {item.relPath}
                    </div>
                    {item.parent && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {item.parent}
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wider shrink-0",
                      item.kind === "kb"
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.kind}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mime.startsWith("image/");
  const Icon = isImage ? FileImage : FileText;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] max-w-[18rem]">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="text-muted-foreground">{formatSize(attachment.size)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
