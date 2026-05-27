"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Lock, Share2, X } from "lucide-react";
import { toast } from "sonner";
import {
  createShareAction,
} from "@/lib/server/shares/actions";
import { getTunnelStatusAction } from "@/lib/server/ngrok/actions";
import type { Share, ShareKind } from "@/lib/server/shares/types";

interface Props {
  kind: ShareKind;
  rootId?: string;
  utilityScope?: "global" | "project";
  utilityId?: string;
  kbRelPath?: string;
  label?: string;
  /** Compact icon-only button when true (e.g. inline in a header). */
  iconOnly?: boolean;
}

/**
 * One-click "Поделиться" button. Opens a small inline form to choose
 * an optional password, then creates the share record on the server.
 * The result is a public URL we copy to clipboard and display so the
 * user can paste it anywhere. Tunnel host is auto-detected from the
 * currently-running ngrok process — if none, we still create the
 * share but warn that the URL only works once the tunnel is up.
 */
export function ShareButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, startCreate] = useTransition();
  const [made, setMade] = useState<{ share: Share; url: string } | null>(null);

  const create = () => {
    startCreate(async () => {
      const status = await getTunnelStatusAction();
      const r = await createShareAction({
        kind: props.kind,
        ...(props.rootId ? { rootId: props.rootId } : {}),
        ...(props.utilityScope ? { utilityScope: props.utilityScope } : {}),
        ...(props.utilityId ? { utilityId: props.utilityId } : {}),
        ...(props.kbRelPath ? { kbRelPath: props.kbRelPath } : {}),
        ...(props.label ? { label: props.label } : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const base = status.status.publicUrl ?? window.location.origin;
      const url = new URL(`/share/${r.share.id}`, base).toString();
      setMade({ share: r.share, url });
      void navigator.clipboard.writeText(url).catch(() => null);
      toast.success(
        status.status.running
          ? "Ссылка создана и скопирована"
          : "Ссылка создана; запусти ngrok-туннель в настройках чтобы открыть извне",
      );
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          props.iconOnly
            ? "p-1 rounded hover:bg-accent text-muted-foreground hover:text-violet-700"
            : "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
        }
        title="Создать публичную ссылку"
      >
        <Share2 className="h-3.5 w-3.5" />
        {!props.iconOnly && "Поделиться"}
      </button>
    );
  }

  if (made) {
    return (
      <div className="rounded border bg-card p-2 text-xs space-y-1.5 w-full max-w-sm">
        <div className="flex items-center gap-1.5 text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          <span className="font-medium">Ссылка создана</span>
        </div>
        <a
          href={made.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] text-violet-700 hover:underline break-all"
        >
          {made.url}
        </a>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(made.url)
                .then(() => toast.success("Скопировано"))
            }
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-accent"
          >
            <Copy className="h-3 w-3" />
            Скопировать
          </button>
          <button
            type="button"
            onClick={() => {
              setMade(null);
              setOpen(false);
              setPassword("");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            Готово
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border bg-card p-2 text-xs space-y-1.5 w-full max-w-sm">
      <div className="flex items-center gap-1.5">
        <Share2 className="h-3.5 w-3.5 text-violet-600" />
        <span className="font-medium">Новая публичная ссылка</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <label className="block text-[10px] text-muted-foreground">
        Пароль (опционально)
      </label>
      <div className="relative">
        <Lock className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="пусто = открытая ссылка"
          className="w-full rounded border bg-background pl-6 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
      </div>
      <button
        type="button"
        onClick={create}
        disabled={creating}
        className="w-full rounded bg-violet-600 text-white px-2 py-1 hover:bg-violet-700 disabled:opacity-50 inline-flex items-center justify-center gap-1"
      >
        {creating ? "Создание…" : "Создать ссылку"}
      </button>
      <p className="text-[10px] text-muted-foreground">
        Ссылку будет видно только после старта ngrok-туннеля (Настройки →
        Публичные ссылки).
      </p>
    </div>
  );
}
