"use client";

import { useTransition } from "react";
import { Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { submitSharePasswordAction } from "../actions";

/**
 * Password gate for protected shares. POSTs to a server action which sets
 * an httpOnly cookie scoped to this share id, then redirects back to the
 * same /share/<id> URL. Failed attempts come back with ?error=bad.
 */
export function ShareAuthForm({
  shareId,
  error,
}: {
  shareId: string;
  error?: string;
}) {
  const t = useTranslations("app");
  const [pending, startSubmit] = useTransition();
  return (
    <form
      action={(formData) =>
        startSubmit(async () => {
          await submitSharePasswordAction(
            shareId,
            (formData.get("password") ?? "").toString(),
          );
        })
      }
      className="space-y-2"
    >
      <label className="block text-xs text-muted-foreground" htmlFor={`pw-${shareId}`}>
        {t("share.auth.passwordLabel")}
      </label>
      <input
        id={`pw-${shareId}`}
        name="password"
        type="password"
        autoFocus
        className="w-full rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400"
        placeholder="••••••••"
      />
      {error === "bad" && (
        <p className="text-xs text-destructive">{t("share.auth.badPassword")}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogIn className="h-3.5 w-3.5" />
        )}
        {t("share.auth.open")}
      </button>
    </form>
  );
}
