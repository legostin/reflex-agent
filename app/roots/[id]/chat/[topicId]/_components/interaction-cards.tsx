"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  HelpCircle,
  Loader2,
  Lock,
  Plug,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  OAuthSetupSteps,
  type OAuthSetupStep,
} from "@/components/oauth-setup-steps";

export interface PermissionState {
  requestId: string;
  agentId: string;
  tool?: string;
  action?: string;
  input?: unknown;
  description?: string;
  resolved?: { decision: "allow" | "deny"; scope?: "once" | "always" };
}

export interface QuestionState {
  questionId: string;
  agentId: string;
  prompt: string;
  header?: string;
  multiSelect?: boolean;
  choices?: string[];
  options?: Array<{ label: string; description?: string }>;
  resolved?: { answer: string };
}

export function PermissionCard({ perm }: { perm: PermissionState }) {
  const [pending, start] = useTransition();
  const resolved = perm.resolved;
  const respond = (
    decision: "allow" | "deny",
    scope?: "once" | "always",
  ) => {
    start(async () => {
      const res = await fetch(`/api/agents/${perm.agentId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "permission",
          requestId: perm.requestId,
          decision,
          ...(scope ? { scope } : {}),
          ...(perm.tool ? { tool: perm.tool } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? `HTTP ${res.status}`);
      }
    });
  };
  return (
    <div
      className={cn(
        "rounded-lg border-2 my-2 p-4 reflex-gradient",
        resolved && "opacity-60",
      )}
    >
      <div className="rounded-md bg-background/95 backdrop-blur p-4">
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>Запрос разрешения</span>
          {perm.tool && (
            <span className="font-mono normal-case tracking-normal">
              {perm.tool}
            </span>
          )}
          <span className="ml-auto font-mono normal-case tracking-normal">
            {perm.requestId}
          </span>
        </div>
        {perm.description && (
          <p className="text-sm mb-2">{perm.description}</p>
        )}
        {perm.input !== undefined && (
          <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto mb-3">
            {safeStringify(perm.input)}
          </pre>
        )}
        {resolved ? (
          <div className="flex items-center gap-2 text-sm">
            {resolved.decision === "allow" ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Разрешено{resolved.scope ? ` (${resolved.scope})` : ""}</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-destructive" />
                <span>Отклонено</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => respond("allow", "once")}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-2 h-3.5 w-3.5" />
              )}
              Разрешить
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => respond("allow", "always")}
              disabled={pending}
            >
              <ShieldCheck className="mr-2 h-3.5 w-3.5" />
              Разрешать всегда
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => respond("deny")}
              disabled={pending}
            >
              <X className="mr-2 h-3.5 w-3.5" />
              Отклонить
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestionCard({ question }: { question: QuestionState }) {
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const resolved = question.resolved;

  // Normalize: choices (flat strings) become options with label-only so the
  // renderer has a single path.
  const options: Array<{ label: string; description?: string }> =
    question.options && question.options.length > 0
      ? question.options
      : (question.choices ?? []).map((c) => ({ label: c }));

  const submit = (answer: string) => {
    if (!answer.trim()) return;
    start(async () => {
      const res = await fetch(`/api/agents/${question.agentId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "answer",
          questionId: question.questionId,
          answer: answer.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? `HTTP ${res.status}`);
      } else {
        setDraft("");
        setPicked(new Set());
      }
    });
  };

  const togglePick = (label: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const submitPicked = () => {
    if (picked.size === 0) return;
    submit(JSON.stringify([...picked]));
  };

  return (
    <div
      className={cn(
        "rounded-lg border-2 my-2 p-4 reflex-gradient",
        resolved && "opacity-60",
      )}
    >
      <div className="rounded-md bg-background/95 backdrop-blur p-4">
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground flex-wrap">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Вопрос от агента</span>
          {question.header && (
            <span className="rounded bg-violet-100 dark:bg-violet-950/60 text-violet-900 dark:text-violet-200 px-1.5 py-0.5 text-[10px] uppercase font-mono">
              {question.header}
            </span>
          )}
          {question.multiSelect && (
            <span className="text-[10px] normal-case tracking-normal italic">
              можно выбрать несколько
            </span>
          )}
          <span className="ml-auto font-mono normal-case tracking-normal">
            {question.questionId}
          </span>
        </div>
        <p className="text-sm font-medium mb-3">{question.prompt}</p>
        {resolved ? (
          <p className="text-sm text-muted-foreground">
            Ответ:{" "}
            <span className="text-foreground">{formatAnswer(resolved.answer)}</span>
          </p>
        ) : (
          <div className="space-y-2">
            {options.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {options.map((opt) => {
                  const isPicked = picked.has(opt.label);
                  if (question.multiSelect) {
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => togglePick(opt.label)}
                        disabled={pending}
                        className={cn(
                          "flex items-start gap-2 text-left rounded-md border p-2.5 transition",
                          isPicked
                            ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                            : "border-input hover:bg-accent/40",
                          pending && "opacity-50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center",
                            isPicked
                              ? "bg-violet-600 border-violet-600 text-white"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {isPicked && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{opt.label}</div>
                          {opt.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => submit(opt.label)}
                      disabled={pending}
                      className={cn(
                        "flex items-start gap-2 text-left rounded-md border p-2.5 transition",
                        "border-input hover:bg-accent/60 hover:border-violet-400",
                        pending && "opacity-50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {question.multiSelect && options.length > 0 && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  выбрано: {picked.size}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={submitPicked}
                  disabled={pending || picked.size === 0}
                >
                  {pending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-3.5 w-3.5" />
                  )}
                  Отправить
                </Button>
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit(draft);
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Свой ответ…"
                disabled={pending}
                className="h-9 text-sm"
              />
              <Button
                type="submit"
                size="sm"
                disabled={pending || !draft.trim()}
              >
                {pending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-2 h-3.5 w-3.5" />
                )}
                Отправить
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pretty-print an answer when displaying a resolved question. Multi-select
 * answers come back as a JSON array string; render as a comma-joined list.
 */
function formatAnswer(answer: string): string {
  if (!answer.startsWith("[")) return answer;
  try {
    const arr = JSON.parse(answer) as unknown;
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return arr.join(", ");
    }
  } catch {
    /* not JSON */
  }
  return answer;
}

export interface McpAddState {
  requestId: string;
  agentId: string;
  server: string;
  label: string;
  description?: string;
  config: unknown;
  secrets?: Array<{
    envKey: string;
    label: string;
    description?: string;
    required?: boolean;
    oauth?: string;
  }>;
  resolved?: { decision: "approve" | "reject" };
}

export function McpAddCard({ entry }: { entry: McpAddState }) {
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const resolved = entry.resolved;

  const respond = (decision: "approve" | "reject") => {
    if (decision === "approve") {
      for (const s of entry.secrets ?? []) {
        // OAuth slots don't receive a manual value — the server resolves
        // them via `$oauth:<provider>` after a one-click authorize. Just
        // verify that authorization actually happened (server will fail
        // hard if not, but a friendly client message is nicer).
        if (s.oauth) continue;
        if (s.required && !values[s.envKey]?.trim()) {
          toast.error(`${s.label || s.envKey} обязателен`);
          return;
        }
      }
    }
    start(async () => {
      const res = await fetch(`/api/agents/${entry.agentId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "mcp-add",
          requestId: entry.requestId,
          decision,
          ...(decision === "approve" ? { secretValues: values } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? `HTTP ${res.status}`);
      }
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border-2 my-2 p-4 reflex-gradient",
        resolved && "opacity-60",
      )}
    >
      <div className="rounded-md bg-background/95 backdrop-blur p-4">
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Plug className="h-3.5 w-3.5" />
          <span>Регистрация MCP-сервера</span>
          <span className="font-mono normal-case tracking-normal">
            {entry.server}
          </span>
          <span className="ml-auto font-mono normal-case tracking-normal">
            {entry.requestId}
          </span>
        </div>
        <div className="text-sm font-medium">{entry.label}</div>
        {entry.description && (
          <p className="text-xs text-muted-foreground mt-1">
            {entry.description}
          </p>
        )}
        <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto my-3">
          {safeStringify(entry.config)}
        </pre>
        {entry.secrets && entry.secrets.length > 0 && !resolved && (
          <div className="space-y-2 mb-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Заполни секреты
            </div>
            {entry.secrets.map((s) =>
              s.oauth ? (
                <OAuthSlotRow key={s.envKey} slot={s} />
              ) : (
                <div key={s.envKey} className="space-y-1">
                  <label className="text-xs flex items-center gap-2">
                    <span className="font-mono">{s.envKey}</span>
                    <span className="text-muted-foreground">{s.label}</span>
                    {s.required && (
                      <span className="text-destructive text-[10px]">*</span>
                    )}
                  </label>
                  {s.description && (
                    <p className="text-[11px] text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  <Input
                    type="password"
                    value={values[s.envKey] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [s.envKey]: e.target.value }))
                    }
                    placeholder={s.required ? "обязательно" : "опционально"}
                    className="font-mono text-xs h-8"
                  />
                </div>
              ),
            )}
          </div>
        )}
        {resolved ? (
          <div className="flex items-center gap-2 text-sm">
            {resolved.decision === "approve" ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" />
                <span>Зарегистрирован</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-destructive" />
                <span>Отклонено</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => respond("approve")}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              <Check className="h-3.5 w-3.5 mr-1" /> Зарегистрировать
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => respond("reject")}
              disabled={pending}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Отклонить
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * OAuth-backed secret slot — instead of asking the user to paste a token,
 * the agent declares which provider owns this env var. We show the provider's
 * status (configured? authorized?) and a one-click button that kicks off the
 * OAuth flow. The actual token never enters chat — when the user clicks
 * Зарегистрировать, the server writes `$oauth:<provider>` into the config,
 * and tokens are hydrated at MCP-call time.
 */
function OAuthSlotRow({
  slot,
}: {
  slot: {
    envKey: string;
    label: string;
    description?: string;
    required?: boolean;
    oauth?: string;
  };
}) {
  const [status, setStatus] = useState<{
    hasClient: boolean;
    hasTokens: boolean;
  } | null>(null);
  const [meta, setMeta] = useState<{
    setupHint: string;
    consoleUrl: string;
    needsClientSecret: boolean;
    setupSteps: OAuthSetupStep[];
  } | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [working, start] = useTransition();
  const [savingClient, startSave] = useTransition();

  const refresh = async () => {
    if (!slot.oauth) return;
    const { listOAuthStatusesAction, getOAuthClientAction } = await import(
      "@/lib/server/oauth-actions"
    );
    const [statusRes, clientRes] = await Promise.all([
      listOAuthStatusesAction(),
      getOAuthClientAction(slot.oauth),
    ]);
    if (statusRes.ok) {
      const s = statusRes.statuses.find((x) => x.id === slot.oauth);
      if (s) setStatus({ hasClient: s.hasClient, hasTokens: s.hasTokens });
    }
    if (clientRes.ok) {
      setMeta({
        setupHint: clientRes.setupHint,
        consoleUrl: clientRes.consoleUrl,
        needsClientSecret: clientRes.needsClientSecret,
        setupSteps: clientRes.setupSteps ?? [],
      });
      if (clientRes.client) {
        setClientId(clientRes.client.clientId);
        setHasSavedSecret(clientRes.client.hasSecret);
      } else {
        setClientId("");
        setHasSavedSecret(false);
      }
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.oauth]);

  const saveClient = () => {
    if (!slot.oauth) return;
    if (!clientId.trim()) {
      toast.error("client_id обязателен");
      return;
    }
    startSave(async () => {
      const { saveOAuthClientAction } = await import(
        "@/lib/server/oauth-actions"
      );
      const res = await saveOAuthClientAction({
        provider: slot.oauth!,
        clientId: clientId.trim(),
        ...(clientSecret ? { clientSecret } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Client сохранён");
      setClientSecret("");
      await refresh();
    });
  };

  const authorize = () => {
    if (!slot.oauth) return;
    start(async () => {
      const { beginOAuthAction, listOAuthStatusesAction } = await import(
        "@/lib/server/oauth-actions"
      );
      const res = await beginOAuthAction(slot.oauth!);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      window.open(
        res.authorizeUrl,
        "reflex-oauth",
        "width=600,height=720,noopener=no",
      );
      const startedAt = Date.now();
      const tick = async () => {
        if (Date.now() - startedAt > 5 * 60_000) {
          toast.error("Authorization timed out");
          return;
        }
        const r = await listOAuthStatusesAction();
        if (r.ok) {
          const cur = r.statuses.find((x) => x.id === slot.oauth);
          if (cur?.hasTokens) {
            toast.success(`${slot.oauth} authorized`);
            setStatus({ hasClient: cur.hasClient, hasTokens: cur.hasTokens });
            return;
          }
        }
        setTimeout(() => void tick(), 1500);
      };
      void tick();
    });
  };

  const needsClient = !status?.hasClient;
  const showForm = expanded || needsClient;

  return (
    <div className="space-y-2 rounded border border-violet-200 bg-violet-50/30 p-2">
      <label className="text-xs flex items-center gap-2">
        <span className="font-mono">{slot.envKey}</span>
        <span className="text-muted-foreground">{slot.label}</span>
        <span className="text-[10px] uppercase tracking-wider text-violet-700 ml-auto">
          OAuth · {slot.oauth}
        </span>
      </label>
      {slot.description && (
        <p className="text-[11px] text-muted-foreground">{slot.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {status?.hasTokens ? (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="h-3 w-3" /> Авторизован
          </span>
        ) : status?.hasClient ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={authorize}
            disabled={working}
            className="h-7 text-xs"
          >
            {working && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Authorize via {slot.oauth}
          </Button>
        ) : (
          <span className="text-xs text-amber-700">
            client_id не настроен — заполни ниже
          </span>
        )}
        {!needsClient && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 text-xs text-muted-foreground gap-1"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            />
            {expanded ? "Скрыть client" : "Изменить client"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          className="h-7 text-xs text-muted-foreground ml-auto"
        >
          Обновить
        </Button>
      </div>

      {showForm && meta && (
        <div className="space-y-2 border-t border-violet-200 pt-2 mt-2">
          {meta.setupHint && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900 leading-snug">
              {meta.setupHint}
            </div>
          )}
          <a
            href={meta.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-violet-700 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Открыть консоль провайдера
          </a>
          {meta.setupSteps.length > 0 && (
            <div className="rounded border border-violet-200 bg-white/60 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Пошагово
              </div>
              <OAuthSetupSteps steps={meta.setupSteps} />
            </div>
          )}
          <div>
            <Label className="text-[10px]">Client ID</Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123…apps.googleusercontent.com"
              className="font-mono text-xs h-7"
            />
          </div>
          {meta.needsClientSecret && (
            <div>
              <Label className="text-[10px]">
                Client secret{" "}
                {hasSavedSecret && (
                  <span className="text-muted-foreground">
                    (сохранён, пусто — не менять)
                  </span>
                )}
              </Label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasSavedSecret ? "••••" : "GOCSPX-…"}
                className="font-mono text-xs h-7"
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={saveClient}
              disabled={savingClient || !clientId.trim()}
              className="h-7 text-xs"
            >
              {savingClient ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Save className="mr-1 h-3 w-3" />
              )}
              Сохранить client
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
