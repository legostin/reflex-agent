"use client";

import { useState } from "react";
import { Bot, Check, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * For arbitrary GitHub repos that aren't already Reflex utilities, the
 * pragmatic adapter is "ask an agent to wrap it." This button just prepares
 * a prompt with the right `<<reflex:utility>>` instructions and lets the
 * user paste it into any project chat — the agent will analyse the repo,
 * generate a Reflex-compatible wrapper, and emit the install directive.
 */
export function InstallViaAgentButton() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const prompt = url.trim()
    ? buildPrompt(url.trim())
    : buildPrompt("<github URL here>");

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    toast.success("Prompt скопирован");
    setTimeout(() => setCopied(false), 1500);
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Bot className="h-4 w-4" />
        From GitHub (via agent)
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              GitHub-репо → Reflex utility (через агента)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Если репо не структурирован как Reflex utility — попроси оркестратора
              проанализировать его и сгенерировать обёртку.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>GitHub URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </div>
          <div>
            <Label className="flex items-center justify-between">
              <span>Prompt для агента</span>
              <Button size="sm" variant="ghost" onClick={copy} className="gap-1">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Скопировано" : "Скопировать"}
              </Button>
            </Label>
            <Textarea
              value={prompt}
              readOnly
              className="font-mono text-xs h-64"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Вставь в чат любого проекта (Sidebar → проект → чат). Агент проанализирует
            репо, придумает thin UI поверх его API/CLI и эмитнет
            <code className="font-mono mx-1">{"<<reflex:utility>>"}</code>
            маркер; установка пройдёт автоматически.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function buildPrompt(url: string): string {
  return `Преобразуй GitHub-репо ${url} в Reflex-утилиту.

Шаги:
1. Прочитай README репозитория (через web.fetch если есть permission, иначе попроси).
2. Определи, что это: npm-пакет / CLI / web app / библиотека.
3. Спроектируй thin Reflex-обёртку:
   - Если это npm-пакет с JS API → util вызывает его через server action (actions/run.ts).
   - Если это CLI → server action exec'ает его, аргументы из UI.
   - Если это web-сервис → util дергает его API через reflex.web.fetch (укажи нужный домен в permissions.web.fetch.domains).
4. UI — одна-две формы для главного use-case'а; default-export functional component.
5. Эмить <<reflex:utility>>{...}<</reflex:utility>> с manifest + files.

Манифест должен содержать source.origin = "github:${url}", category = подходящая ("dev", "media", "data", "kb", и т.д.), и явные permissions.

Не выдумывай API — если не уверен в форме вызова, спроси через <<reflex:question>>.`;
}
