"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { GitMerge, Loader2, RotateCcw, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listTemplatesAction,
  loadTemplateAction,
  mergeTemplateAction,
  resetTemplateAction,
  saveTemplateAction,
} from "@/lib/server/prompt-actions";

interface TemplateMeta {
  name: string;
  label: string;
  variables: string[];
}

interface TemplateState {
  body: string;
  defaultBody: string;
  missingSections: string[];
  path: string;
  loading: boolean;
  saving: boolean;
  resetting: boolean;
  merging: boolean;
  variables: string[];
}

const EMPTY: TemplateState = {
  body: "",
  defaultBody: "",
  missingSections: [],
  path: "",
  loading: true,
  saving: false,
  resetting: false,
  merging: false,
  variables: [],
};

export function PromptTemplatesEditor() {
  const t = useTranslations("settings");
  const [metas, setMetas] = useState<TemplateMeta[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, TemplateState>>({});
  const [, startSave] = useTransition();
  const [, startReset] = useTransition();

  useEffect(() => {
    void (async () => {
      const list = await listTemplatesAction();
      setMetas(list);
      if (list[0]) setActive(list[0].name);
      const init: Record<string, TemplateState> = {};
      for (const m of list) init[m.name] = { ...EMPTY };
      setStates(init);
      for (const m of list) {
        void loadOne(m.name);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOne = async (name: string) => {
    setStates((s) => ({
      ...s,
      [name]: { ...(s[name] ?? EMPTY), loading: true },
    }));
    const res = await loadTemplateAction(name);
    if (!res.ok) {
      toast.error(`Load failed: ${res.error}`);
      setStates((s) => ({
        ...s,
        [name]: { ...(s[name] ?? EMPTY), loading: false },
      }));
      return;
    }
    setStates((s) => ({
      ...s,
      [name]: {
        body: res.body,
        defaultBody: res.defaultBody,
        missingSections: res.missingSections,
        path: res.path,
        loading: false,
        saving: false,
        resetting: false,
        merging: false,
        variables: res.variables,
      },
    }));
  };

  const merge = (name: string) => {
    const cur = states[name];
    if (!cur) return;
    setStates((s) => ({ ...s, [name]: { ...(s[name] ?? EMPTY), merging: true } }));
    void (async () => {
      const res = await mergeTemplateAction(name);
      if (!res.ok) {
        toast.error(`Merge failed: ${res.error}`);
        setStates((s) => ({
          ...s,
          [name]: { ...(s[name] ?? EMPTY), merging: false },
        }));
        return;
      }
      toast.success(
        res.appended.length === 0
          ? t("promptTemplates.merged")
          : t("promptTemplates.mergedAppended", {
              count: res.appended.length,
              names: res.appended.join(", "),
            }),
      );
      setStates((s) => ({
        ...s,
        [name]: {
          ...(s[name] ?? EMPTY),
          body: res.body,
          missingSections: [],
          merging: false,
        },
      }));
    })();
  };

  const updateBody = (name: string, body: string) => {
    setStates((s) => {
      const cur = s[name] ?? EMPTY;
      return { ...s, [name]: { ...cur, body } };
    });
  };

  const save = (name: string) => {
    startSave(async () => {
      const cur = states[name];
      if (!cur) return;
      setStates((s) => ({ ...s, [name]: { ...cur, saving: true } }));
      const res = await saveTemplateAction(name, cur.body);
      setStates((s) => {
        const c = s[name] ?? EMPTY;
        return { ...s, [name]: { ...c, saving: false } };
      });
      if (!res.ok) toast.error(`Save failed: ${res.error}`);
      else toast.success(`${name}.md saved`);
    });
  };

  const reset = (name: string) => {
    if (!confirm(`Reset ${name}.md to the default template?`)) return;
    startReset(async () => {
      const cur = states[name] ?? EMPTY;
      setStates((s) => ({ ...s, [name]: { ...cur, resetting: true } }));
      const res = await resetTemplateAction(name);
      setStates((s) => {
        const c = s[name] ?? EMPTY;
        return {
          ...s,
          [name]: {
            ...c,
            resetting: false,
            ...(res.ok && res.body ? { body: res.body } : {}),
          },
        };
      });
      if (!res.ok) toast.error(`Reset failed: ${res.error}`);
      else toast.success(`${name}.md reset`);
    });
  };

  if (metas.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading
          templates…
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs value={active ?? metas[0]!.name} onValueChange={setActive}>
      <TabsList>
        {metas.map((m) => (
          <TabsTrigger key={m.name} value={m.name}>
            {m.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {metas.map((m) => {
        const st = states[m.name] ?? EMPTY;
        return (
          <TabsContent key={m.name} value={m.name} className="mt-3">
            <Card>
              <CardContent className="pt-6 space-y-3">
                {st.missingSections.length > 0 && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                    <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">
                        {t("promptTemplates.templateUpdated", {
                          count: st.missingSections.length,
                        })}
                      </div>
                      <div className="text-amber-800/80">
                        {t("promptTemplates.missingFromYours")}{" "}
                        {st.missingSections.map((h, i) => (
                          <span key={h}>
                            <code className="font-mono">## {h}</code>
                            {i < st.missingSections.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => merge(m.name)}
                      disabled={st.merging || st.saving || st.resetting}
                      className="border-amber-400 hover:bg-amber-100 shrink-0"
                    >
                      {st.merging ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="mr-1 h-3.5 w-3.5" />
                      )}
                      {t("promptTemplates.addMissing")}
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Variables:</span>
                  {st.variables.map((v) => (
                    <Badge key={v} variant="outline" className="font-mono">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
                <Textarea
                  value={st.body}
                  onChange={(e) => updateBody(m.name, e.target.value)}
                  rows={18}
                  className="font-mono text-xs"
                  disabled={st.loading}
                  placeholder={st.loading ? "loading…" : ""}
                />
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {st.path}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => reset(m.name)}
                      disabled={st.resetting || st.saving}
                    >
                      <RotateCcw
                        className={`mr-1 h-4 w-4 ${
                          st.resetting ? "animate-spin" : ""
                        }`}
                      />
                      Reset to default
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => save(m.name)}
                      disabled={st.saving || st.loading}
                    >
                      {st.saving ? (
                        <>
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />{" "}
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="mr-1 h-4 w-4" /> Save template
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
