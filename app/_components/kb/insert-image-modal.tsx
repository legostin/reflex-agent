"use client";

import { useEffect, useState, useTransition } from "react";
import { Image as ImageIcon, Search, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  attachAction,
  generateAction,
  searchAction,
  uploadAction,
} from "./insert-image-actions";
import type { GenProvider, SearchProvider } from "@/lib/server/images/service";

interface SearchHit {
  url: string;
  thumb: string;
  attribution: { name: string; link: string };
  width?: number;
  height?: number;
  provider: SearchProvider;
}

interface Props {
  rootId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after the user picks an image. The `markdown` snippet is ready
   * to drop into a KB body; `relPath` points to the saved KB entry when
   * `attachToKb` was checked.
   */
  onInsert?: (result: {
    url: string;
    markdown: string;
    kbRelPath?: string;
  }) => void;
}

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"] as const;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Chunked btoa() — avoids "Maximum call stack" on multi-MB uploads while
  // staying free of any Node Buffer dependency in client bundles.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

export function InsertImageModal({
  rootId,
  open,
  onOpenChange,
  onInsert,
}: Props) {
  // ---- Generate tab state -----------------------------------------------
  const [prompt, setPrompt] = useState("");
  const [genProvider, setGenProvider] = useState<GenProvider>("gemini");
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [genAttachKb, setGenAttachKb] = useState(true);
  const [genResult, setGenResult] = useState<{
    url: string;
    markdown: string;
    kbRelPath?: string;
  } | null>(null);
  const [generating, startGenerate] = useTransition();

  // ---- Search tab state -------------------------------------------------
  const [query, setQuery] = useState("");
  const [searchProvider, setSearchProvider] = useState<SearchProvider>("unsplash");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, startSearch] = useTransition();
  const [attachingUrl, setAttachingUrl] = useState<string | null>(null);
  const [searchAttachKb, setSearchAttachKb] = useState(true);

  // ---- Upload tab state -------------------------------------------------
  const [uploadAlt, setUploadAlt] = useState("");
  const [uploadAttachKb, setUploadAttachKb] = useState(true);
  const [uploading, startUpload] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const onGenerate = () => {
    if (!prompt.trim()) return;
    setGenResult(null);
    startGenerate(async () => {
      const res = await generateAction({
        rootId,
        prompt: prompt.trim(),
        provider: genProvider,
        aspectRatio,
        attachToKb: genAttachKb,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setGenResult({
        url: res.url,
        markdown: res.markdown,
        ...(res.kbRelPath ? { kbRelPath: res.kbRelPath } : {}),
      });
    });
  };

  const insertGenerated = () => {
    if (!genResult) return;
    onInsert?.(genResult);
    toast.success(
      genResult.kbRelPath
        ? `Сохранено в KB: ${genResult.kbRelPath}`
        : "Картинка готова",
    );
    onOpenChange(false);
  };

  const onSearch = () => {
    if (!query.trim()) return;
    setHits([]);
    startSearch(async () => {
      const res = await searchAction({
        rootId,
        query: query.trim(),
        provider: searchProvider,
        count: 12,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setHits(res.results as SearchHit[]);
    });
  };

  const pickSearchHit = (hit: SearchHit) => {
    setAttachingUrl(hit.url);
    startSearch(async () => {
      const res = await attachAction({
        rootId,
        sourceUrl: hit.url,
        alt: query.trim() || "image",
        attribution: hit.attribution,
        attachToKb: searchAttachKb,
      });
      setAttachingUrl(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onInsert?.({
        url: res.url,
        markdown: res.markdown,
        ...(res.kbRelPath ? { kbRelPath: res.kbRelPath } : {}),
      });
      toast.success(
        res.kbRelPath
          ? `Сохранено в KB: ${res.kbRelPath}`
          : "Картинка добавлена в проект",
      );
      onOpenChange(false);
    });
  };

  const onUploadFile = (file: File) => {
    startUpload(async () => {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const res = await uploadAction({
        rootId,
        base64,
        mime: file.type,
        alt: uploadAlt || file.name.replace(/\.[^.]+$/, ""),
        attachToKb: uploadAttachKb,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onInsert?.({
        url: res.url,
        markdown: res.markdown,
        ...(res.kbRelPath ? { kbRelPath: res.kbRelPath } : {}),
      });
      toast.success(
        res.kbRelPath
          ? `Сохранено в KB: ${res.kbRelPath}`
          : "Картинка загружена",
      );
      onOpenChange(false);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative bg-card border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <ImageIcon className="h-4 w-4 text-violet-600" />
          <h2 className="text-sm font-medium flex-1">Картинка в KB</h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Tabs defaultValue="generate" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-4 mt-3 self-start">
            <TabsTrigger value="generate">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Сгенерировать
            </TabsTrigger>
            <TabsTrigger value="search">
              <Search className="mr-1 h-3.5 w-3.5" /> Найти
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="mr-1 h-3.5 w-3.5" /> Загрузить
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            <TabsContent value="generate" className="px-4 py-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="img-prompt">Промпт</Label>
                <Textarea
                  id="img-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Подробное описание: стиль, композиция, освещение..."
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Провайдер</Label>
                  <Select
                    value={genProvider}
                    onValueChange={(v) => setGenProvider(v as GenProvider)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Gemini Nano Banana</SelectItem>
                      <SelectItem value="codex">Codex $imagegen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Соотношение</Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={setAspectRatio}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIOS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={genAttachKb}
                  onChange={(e) => setGenAttachKb(e.target.checked)}
                />
                Сохранить как отдельную запись в KB (kind: image)
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={onGenerate}
                  disabled={generating || !prompt.trim()}
                >
                  {generating ? "Генерирую..." : "Сгенерировать"}
                </Button>
                {generating && (
                  <span className="text-xs text-muted-foreground">
                    Может занять до минуты
                  </span>
                )}
              </div>
              {generating ? (
                <Skeleton className="h-64 w-full" />
              ) : genResult ? (
                <div className="space-y-2 border rounded p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={genResult.url}
                    alt={prompt}
                    className="max-h-80 mx-auto rounded"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setGenResult(null)}
                    >
                      Ещё раз
                    </Button>
                    <Button type="button" size="sm" onClick={insertGenerated}>
                      Вставить
                    </Button>
                  </div>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="search" className="px-4 py-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="например: mountains sunrise"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                />
                <Select
                  value={searchProvider}
                  onValueChange={(v) =>
                    setSearchProvider(v as SearchProvider)
                  }
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unsplash">Unsplash</SelectItem>
                    <SelectItem value="pexels">Pexels</SelectItem>
                    <SelectItem value="brave">Brave (весь веб)</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSearch}
                  disabled={searching || !query.trim()}
                >
                  Найти
                </Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={searchAttachKb}
                  onChange={(e) => setSearchAttachKb(e.target.checked)}
                />
                Сохранить как отдельную запись в KB (kind: image)
              </label>
              {searching && hits.length === 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 w-full" />
                  ))}
                </div>
              ) : hits.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {hits.map((h) => (
                    <button
                      key={h.url}
                      type="button"
                      disabled={attachingUrl !== null}
                      onClick={() => pickSearchHit(h)}
                      className="group relative overflow-hidden rounded border hover:border-violet-500 disabled:opacity-50"
                      title={`${h.attribution.name} · ${h.provider}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={h.thumb}
                        alt=""
                        className="h-32 w-full object-cover"
                      />
                      <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] bg-black/60 text-white truncate">
                        {h.attribution.name}
                      </div>
                      {attachingUrl === h.url && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-xs text-white">
                          Сохраняю…
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Нужен ключ Unsplash / Pexels в Settings → Images.
                </p>
              )}
            </TabsContent>

            <TabsContent value="upload" className="px-4 py-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="img-alt">Подпись (alt)</Label>
                <Input
                  id="img-alt"
                  value={uploadAlt}
                  onChange={(e) => setUploadAlt(e.target.value)}
                  placeholder="Что на картинке"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={uploadAttachKb}
                  onChange={(e) => setUploadAttachKb(e.target.checked)}
                />
                Сохранить как отдельную запись в KB (kind: image)
              </label>
              <Input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(file);
                }}
              />
              {uploading && (
                <p className="text-xs text-muted-foreground">Загружаю…</p>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  );
}
