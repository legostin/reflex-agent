"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpCircle,
  Boxes,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyUtilityUpdateAction,
  checkUtilityUpdatesAction,
  installCuratedAction,
  listCuratedAction,
  removeUtilityAction,
  type UpdateInfo,
} from "@/lib/server/utilities/actions";
import { dispatchReflex, REFLEX_EVENTS } from "@/lib/client/events";

interface CuratedItem {
  id: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  github: string;
  suggestedScope?: "global" | "project";
  author?: string;
}

export interface InstalledRef {
  id: string;
  name: string;
  scope: "global" | "project";
}

interface Props {
  rootId: string;
  /** Utilities installed in THIS project (or globally). Drives the
   *  "already / remove" affordances at the top of the popover. */
  installed: InstalledRef[];
}

/**
 * Header button on the project page. Popover with:
 *   • "Установлены в этом проекте" — open + delete affordances.
 *   • "Каталог" — curated catalogue, one-tap install into the current
 *     project (rootId implicit).
 *
 * After install/remove we dispatch `kbChanged` + router.refresh() so
 * the dashboard's widget library reflects the change.
 */
export function AddUtilityButton({ rootId, installed }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CuratedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [updates, setUpdates] = useState<UpdateInfo[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const installedIds = new Set(installed.map((u) => u.id));
  const projectInstalled = installed.filter((u) => u.scope === "project");
  const updateById = new Map(updates.map((u) => [u.id, u]));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open || items.length > 0 || loading) return;
    setLoading(true);
    void (async () => {
      try {
        const r = await listCuratedAction();
        setItems(r.items);
      } catch {
        toast.error("Не удалось загрузить каталог");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, items.length, loading]);

  // Probe for updates whenever the popover opens — cheap for builtins
  // (one mtime + JSON.parse per utility) and bounded for github
  // (HEAD-sha fetch, 1 RTT each, swallowed on offline).
  useEffect(() => {
    if (!open || installed.length === 0) return;
    void (async () => {
      const r = await checkUtilityUpdatesAction({ rootId });
      if (r.ok) setUpdates(r.updates);
    })();
  }, [open, installed.length, rootId]);

  const applyUpdate = (u: UpdateInfo) => {
    setActive(u.id);
    startBusy(async () => {
      const r = await applyUtilityUpdateAction({ ...u, rootId });
      setActive(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `«${u.name}» обновлено: ${u.currentVersion} → ${r.newVersion}`,
      );
      setUpdates((cur) => cur.filter((x) => x.id !== u.id));
      dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
      router.refresh();
    });
  };

  const install = (item: CuratedItem) => {
    setActive(item.id);
    startBusy(async () => {
      const scope: "global" | "project" = item.suggestedScope ?? "global";
      const r = await installCuratedAction({
        github: item.github,
        scope,
        ...(scope === "project" ? { rootId } : {}),
      });
      setActive(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`«${item.name}» установлено в проект`);
      dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
      router.refresh();
    });
  };

  const remove = (u: InstalledRef) => {
    if (
      !confirm(
        `Удалить «${u.name}»? Виджет-карточка пропадёт, данные в KB останутся.`,
      )
    )
      return;
    setActive(u.id);
    startBusy(async () => {
      const r = await removeUtilityAction(
        u.scope,
        u.id,
        u.scope === "project" ? rootId : undefined,
      );
      setActive(null);
      if (!r.ok) {
        toast.error(r.error ?? "Не удалось удалить");
        return;
      }
      toast.success(`«${u.name}» удалено`);
      dispatchReflex(REFLEX_EVENTS.kbChanged(rootId));
      router.refresh();
    });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={() => setOpen((v) => !v)}
        title="Установленные + каталог"
      >
        <Boxes className="h-4 w-4" />
        Утилиты
        {projectInstalled.length > 0 && (
          <span className="ml-1 text-[10px] rounded-full bg-violet-100 text-violet-700 px-1.5">
            {projectInstalled.length}
          </span>
        )}
        {updates.length > 0 && (
          <span
            className="ml-0.5 text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5 inline-flex items-center gap-0.5"
            title={`Обновлений: ${updates.length}`}
          >
            <ArrowUpCircle className="h-2.5 w-2.5" />
            {updates.length}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[440px] max-h-[75vh] overflow-y-auto rounded-lg border bg-popover shadow-lg">
          <div className="sticky top-0 bg-popover flex items-center gap-2 px-3 py-2 border-b">
            <Boxes className="h-3.5 w-3.5 text-violet-600" />
            <span className="text-xs font-medium">Мини-приложения</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto p-0.5 rounded hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {projectInstalled.length > 0 && (
            <section className="p-2 border-b">
              <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Установлены в этом проекте
              </div>
              <ul className="space-y-1">
                {projectInstalled.map((u) => {
                  const upd = updateById.get(u.id);
                  return (
                  <li
                    key={u.id}
                    className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-xs"
                  >
                    <span className="flex-1 min-w-0">
                      <div className="truncate font-medium">{u.name}</div>
                      {upd && (
                        <div className="text-[10px] text-amber-700 inline-flex items-center gap-0.5">
                          <ArrowUpCircle className="h-2.5 w-2.5" />
                          {upd.currentVersion} → {upd.latestVersion}
                        </div>
                      )}
                    </span>
                    {upd && (
                      <button
                        type="button"
                        onClick={() => applyUpdate(upd)}
                        disabled={busy && active === u.id}
                        className="text-[11px] rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-0.5"
                        title="Применить обновление"
                      >
                        {busy && active === u.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ArrowUpCircle className="h-3 w-3" />
                        )}
                        Обновить
                      </button>
                    )}
                    <Link
                      href={`/utilities/${u.scope}/${u.id}?rootId=${encodeURIComponent(rootId)}`}
                      className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      title="Открыть"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(u)}
                      disabled={busy && active === u.id}
                      className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      title="Удалить из проекта"
                    >
                      {busy && active === u.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="p-2">
            <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Каталог
            </div>
            {loading ? (
              <div className="px-2 py-4 text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Загружаю…
              </div>
            ) : items.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                Каталог пуст.
              </p>
            ) : (
              <ul className="space-y-1">
                {items.map((it) => {
                  const already = installedIds.has(it.id);
                  const isBusy = active === it.id && busy;
                  return (
                    <li
                      key={it.id}
                      className="rounded-md border bg-card px-2 py-2"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-xl leading-none">{it.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm">{it.name}</div>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {it.description}
                          </p>
                        </div>
                        {already ? (
                          <span className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5">
                            <Check className="h-3 w-3" /> уже
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => install(it)}
                            disabled={isBusy || busy}
                            className="text-[11px] rounded bg-violet-600 px-2 py-1 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-0.5"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Добавить
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
