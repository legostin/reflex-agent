"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send, Bot } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import type { Settings } from "@/lib/settings";
import type { RegistryEntry } from "@/lib/registry";
import { listRootsAction } from "@/lib/server/registry-actions";
import {
  patchTelegramSettingsAction,
  testTelegramAction,
} from "@/lib/server/notify/actions";

/**
 * Connect a Telegram bot so Reflex can deliver scheduler / workflow /
 * agent output to a chat the user already lives in — and accept replies
 * (the inbound poller runs an agent turn and answers back).
 *
 * Auto-saves on edit (debounced) like the ngrok panel, so the inbound
 * poller (which reads settings from disk) picks up changes without a
 * separate Save click.
 */
interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export function TelegramSection({ settings, onChange }: Props) {
  const tg = settings.notify.telegram;
  const [roots, setRoots] = useState<RegistryEntry[]>([]);
  const [testing, startTest] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void listRootsAction().then((r) => {
      if (r.ok) setRoots(r.entries);
    });
  }, []);

  const patch = (partial: Partial<Settings["notify"]["telegram"]>) => {
    const nextTg = { ...tg, ...partial };
    onChange({ notify: { ...settings.notify, telegram: nextTg } });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await patchTelegramSettingsAction(partial);
      if (!res.ok) toast.error(res.error ?? "Couldn't save Telegram settings");
    }, 600);
  };

  const flush = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await patchTelegramSettingsAction(tg);
    }
  };

  const sendTest = () => {
    startTest(async () => {
      await flush();
      const r = await testTelegramAction();
      if (!r.ok) {
        toast.error(r.error ?? "Test failed");
        return;
      }
      toast.success("Test message sent — check Telegram");
    });
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-violet-600" />
          <span>Telegram</span>
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal">
            <input
              type="checkbox"
              checked={tg.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Create a bot with{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            @BotFather
          </a>
          , paste its token, then send your bot a message and put your chat id
          below (get it from{" "}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            @userinfobot
          </a>
          ). Reflex pushes notifications here and answers your replies.
        </p>

        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="tg-token">
            Bot token
          </label>
          <input
            id="tg-token"
            type="password"
            autoComplete="off"
            value={tg.botToken}
            onChange={(e) => patch({ botToken: e.target.value })}
            placeholder="123456:ABC-DEF..."
            className="rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="tg-chat">
            Chat id
          </label>
          <input
            id="tg-chat"
            type="text"
            value={tg.chatId}
            onChange={(e) => patch({ chatId: e.target.value })}
            placeholder="123456789"
            className="rounded border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium" htmlFor="tg-root">
            Space for inbound chat
          </label>
          <select
            id="tg-root"
            value={tg.rootId}
            onChange={(e) => patch({ rootId: e.target.value })}
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
          >
            <option value="">First Space (default)</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.path.split("/").filter(Boolean).pop() ?? r.path}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            Replies you send in Telegram run an agent turn in this Space (its
            memory + KB + tools).
          </p>
        </div>

        <button
          type="button"
          onClick={sendTest}
          disabled={testing || !tg.botToken || !tg.chatId}
          className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send test message
        </button>
      </CardContent>
    </Card>
  );
}
