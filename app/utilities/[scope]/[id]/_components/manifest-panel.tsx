"use client";

import { useState, useTransition } from "react";
import {
  Hammer,
  Loader2,
  Pencil,
  RefreshCw,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  checkUpdateAction,
  editUtilityAction,
  rebuildUtilityAction,
} from "@/lib/server/utilities/actions";
import type {
  Manifest,
  UtilityScope,
} from "@/lib/server/utilities/types";
import { SecretsSection } from "./secrets-section";

export function ManifestPanel({
  scope,
  id,
  rootId,
  manifest,
  dir,
}: {
  scope: UtilityScope;
  id: string;
  rootId?: string;
  manifest: Manifest;
  dir: string;
}) {
  const t = useTranslations("app");
  const [rebuilding, startRebuild] = useTransition();
  const [checking, startCheck] = useTransition();
  const [editing, startEdit] = useTransition();
  const router = useRouter();
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  const rebuild = () =>
    startRebuild(async () => {
      const res = await rebuildUtilityAction(scope, id, rootId);
      if (!res.ok) toast.error(res.error ?? "fail");
      else {
        toast.success(t("utilities.manifest.bundleRebuilt"));
        router.refresh();
      }
    });

  const checkUpdate = () =>
    startCheck(async () => {
      const res = await checkUpdateAction(scope, id, rootId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.upToDate) {
        setUpdateBanner(null);
        toast.success(t("utilities.manifest.upToDate"));
      } else {
        setUpdateBanner(
          t("utilities.manifest.newShaAvailable", {
            sha: res.latestSha?.slice(0, 7) ?? "",
          }),
        );
      }
    });

  const submitEdit = () => {
    const instr = instruction.trim();
    if (!instr) {
      toast.error(t("utilities.manifest.editEmpty"));
      return;
    }
    startEdit(async () => {
      const res = await editUtilityAction({
        scope,
        id,
        ...(rootId ? { rootId } : {}),
        instruction: instr,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("utilities.manifest.topicStarted"));
      setInstruction("");
      router.push(`/roots/${res.rootId}/chat/${res.topicId}`);
    });
  };

  const isGithub = manifest.source?.origin?.startsWith("github:");

  return (
    <div className="space-y-4 text-xs">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          {t("utilities.manifest.sourceTitle")}
        </div>
        <div className="space-y-1">
          <Badge variant="secondary" className="capitalize">
            {manifest.source?.type ?? "unknown"}
          </Badge>
          {manifest.source?.origin && (
            <div className="font-mono break-all text-muted-foreground">
              {manifest.source.origin}
            </div>
          )}
          {manifest.source?.fetchedAt && (
            <div className="text-muted-foreground">
              {new Date(manifest.source.fetchedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          {t("utilities.manifest.filesTitle")}
        </div>
        <div className="font-mono break-all text-muted-foreground">{dir}</div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
          <Shield className="h-3 w-3" /> Permissions
        </div>
        <PermissionsList manifest={manifest} />
      </div>

      {(manifest.secrets?.length ?? 0) > 0 && (
        <div className="pt-2 border-t">
          <SecretsSection
            scope={scope}
            id={id}
            {...(rootId ? { rootId } : {})}
            declared={manifest.secrets ?? []}
          />
        </div>
      )}

      {manifest.serverActions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            {t("utilities.manifest.serverActions")}
          </div>
          <ul className="space-y-1">
            {manifest.serverActions.map((a) => (
              <li key={a.name}>
                <Badge variant="outline" className="font-mono mr-1">
                  {a.name}
                </Badge>
                <span className="text-muted-foreground">→ {a.entry}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-2 border-t space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Pencil className="h-3 w-3" /> {t("utilities.manifest.editTitle")}
        </div>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t("utilities.manifest.editPlaceholder")}
          className="text-xs min-h-[80px]"
          disabled={editing}
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={submitEdit}
          disabled={editing || !instruction.trim()}
        >
          {editing ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="mr-2 h-3.5 w-3.5" />
          )}
          {t("utilities.manifest.editButton")}
        </Button>
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={rebuild}
          disabled={rebuilding}
        >
          {rebuilding ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Hammer className="mr-2 h-3.5 w-3.5" />
          )}
          {t("utilities.manifest.rebuildButton")}
        </Button>
        {isGithub && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={checkUpdate}
            disabled={checking}
          >
            {checking ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            {t("utilities.manifest.checkUpdates")}
          </Button>
        )}
        {updateBanner && (
          <div className="rounded border border-emerald-400 bg-emerald-50 px-2 py-1 text-emerald-900">
            {updateBanner}{t("utilities.manifest.updateBannerSuffix")}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionsList({ manifest }: { manifest: Manifest }) {
  const t = useTranslations("app");
  const p = manifest.permissions;
  const rows: string[] = [];
  if (p.llm?.tasks?.length) rows.push(`llm.tasks = [${p.llm.tasks.join(", ")}]`);
  if (p.kb?.read) rows.push("kb.read");
  if (p.kb?.write) rows.push("kb.write");
  if (p.kb?.kinds?.length) rows.push(`kb.kinds = [${p.kb.kinds.join(", ")}]`);
  if (p.fs?.sandbox) rows.push("fs (sandboxed in data/)");
  if (p.web?.fetch?.domains?.length)
    rows.push(`web.fetch = [${p.web.fetch.domains.join(", ")}]`);
  if (p.web?.search) rows.push("web.search");
  if (p.audit?.write) rows.push("audit.write");
  if (p.workers?.enabled)
    rows.push(`workers (max ${p.workers.maxConcurrent ?? 1})`);
  if (rows.length === 0) {
    return <p className="text-muted-foreground italic">{t("utilities.manifest.noPermissions")}</p>;
  }
  return (
    <ul className="space-y-0.5 font-mono">
      {rows.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}
