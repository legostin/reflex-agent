"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteUtilitySecretAction,
  listUtilitySecretsAction,
  setUtilitySecretAction,
} from "@/lib/server/utilities/actions";
import type {
  SecretDeclaration,
  UtilityScope,
} from "@/lib/server/utilities/types";

interface Props {
  scope: UtilityScope;
  id: string;
  rootId?: string;
  declared: SecretDeclaration[];
}

interface SlotState {
  set: boolean;
  draft: string;
  reveal: boolean;
}

/**
 * Renders each `manifest.secrets` slot as a password input. The component
 * never knows the stored value — server-side `listUtilitySecretsAction` only
 * returns presence flags. Saving writes to ~/.reflex/secrets/... server-side.
 */
export function SecretsSection({ scope, id, rootId, declared }: Props) {
  const t = useTranslations("app");
  const [slots, setSlots] = useState<Record<string, SlotState>>(() => {
    const m: Record<string, SlotState> = {};
    for (const d of declared) m[d.key] = { set: false, draft: "", reveal: false };
    return m;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      const res = await listUtilitySecretsAction({
        scope,
        id,
        ...(rootId ? { rootId } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSlots((cur) => {
        const next: Record<string, SlotState> = {};
        for (const s of res.secrets) {
          next[s.key] = {
            set: s.set,
            draft: "",
            reveal: cur[s.key]?.reveal ?? false,
          };
        }
        return next;
      });
    });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id, rootId]);

  const save = async (key: string) => {
    const slot = slots[key];
    if (!slot || !slot.draft) {
      toast.error(t("utilities.secrets.enterValue"));
      return;
    }
    setBusy(key);
    try {
      const res = await setUtilitySecretAction({
        scope,
        id,
        ...(rootId ? { rootId } : {}),
        key,
        value: slot.draft,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("utilities.secrets.saved", { key }));
      setSlots((cur) => ({
        ...cur,
        [key]: { set: true, draft: "", reveal: false },
      }));
    } finally {
      setBusy(null);
    }
  };

  const clear = async (key: string) => {
    setBusy(key);
    try {
      const res = await deleteUtilitySecretAction({
        scope,
        id,
        ...(rootId ? { rootId } : {}),
        key,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("utilities.secrets.deleted", { key }));
      setSlots((cur) => ({
        ...cur,
        [key]: { set: false, draft: "", reveal: false },
      }));
    } finally {
      setBusy(null);
    }
  };

  if (declared.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <KeyRound className="h-3 w-3" /> {t("utilities.secrets.title")}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("utilities.secrets.description1")}
        <code className="font-mono">~/.reflex/secrets/</code>
        {t("utilities.secrets.description2")}{" "}
        <code className="font-mono">reflex.secrets.get</code>.
      </p>
      <ul className="space-y-3">
        {declared.map((d) => {
          const slot = slots[d.key] ?? { set: false, draft: "", reveal: false };
          const itemBusy = busy === d.key;
          return (
            <li key={d.key} className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <span className="font-mono">{d.key}</span>
                {slot.set ? (
                  <Badge variant="secondary" className="gap-1">
                    <Check className="h-2.5 w-2.5" /> set
                  </Badge>
                ) : d.required ? (
                  <Badge variant="destructive">{t("utilities.secrets.missingRequired")}</Badge>
                ) : (
                  <Badge variant="outline">{t("utilities.secrets.empty")}</Badge>
                )}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {d.label}
                {d.description ? ` · ${d.description}` : ""}
              </p>
              <div className="flex items-center gap-1">
                <Input
                  type={slot.reveal ? "text" : "password"}
                  value={slot.draft}
                  onChange={(e) =>
                    setSlots((cur) => ({
                      ...cur,
                      [d.key]: { ...slot, draft: e.target.value },
                    }))
                  }
                  placeholder={slot.set ? t("utilities.secrets.placeholderSet") : t("utilities.secrets.placeholderEmpty")}
                  className="font-mono text-xs flex-1 h-8"
                  disabled={itemBusy}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() =>
                    setSlots((cur) => ({
                      ...cur,
                      [d.key]: { ...slot, reveal: !slot.reveal },
                    }))
                  }
                  title={slot.reveal ? t("utilities.secrets.hide") : t("utilities.secrets.show")}
                >
                  {slot.reveal ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-7 text-xs flex-1"
                  onClick={() => void save(d.key)}
                  disabled={itemBusy || !slot.draft}
                >
                  {itemBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    t("utilities.secrets.save")
                  )}
                </Button>
                {slot.set && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void clear(d.key)}
                    disabled={itemBusy}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
