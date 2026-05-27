import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Github, Hammer, ListTree } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getUtility, listUtilities } from "@/lib/server/utilities/store";
import type { UtilityScope } from "@/lib/server/utilities/types";
import { UtilityFrame } from "./_components/utility-frame";
import { ManifestPanel } from "./_components/manifest-panel";
import { ShareButton } from "@/app/_components/share-button";

export const dynamic = "force-dynamic";

export default async function UtilityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<{ rootId?: string }>;
}) {
  const { scope, id } = await params;
  const { rootId } = await searchParams;
  if (scope !== "global" && scope !== "project") notFound();
  const t = await getTranslations("app");
  if (scope === "project" && !rootId) {
    const matches = (await listUtilities({ scope: "project" })).filter(
      (u) => u.manifest.id === id,
    );
    if (matches.length === 1 && matches[0].rootId) {
      redirect(
        `/utilities/project/${encodeURIComponent(id)}?rootId=${encodeURIComponent(matches[0].rootId)}`,
      );
    }
    if (matches.length === 0) notFound();
    return (
      <main className="flex-1 flex flex-col min-h-0">
        <header className="border-b px-6 py-3 flex items-start gap-4">
          <Button asChild variant="ghost" size="sm" className="-ml-3 mt-0.5">
            <Link href="/utilities">
              <ArrowLeft className="mr-1 h-4 w-4" /> {t("utilities.utilitiesLink")}
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-medium truncate">
              {t("utilities.installedInManyProjects")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t("utilities.pickProjectPrefix")}{" "}
              <code className="font-mono">{id}</code>{" "}
              {t("utilities.pickProjectSuffix")}
            </p>
          </div>
        </header>
        <Separator />
        <ul className="p-6 space-y-2">
          {matches.map((m) => (
            <li key={m.rootId}>
              <Link
                href={`/utilities/project/${encodeURIComponent(id)}?rootId=${encodeURIComponent(m.rootId!)}`}
                className="block rounded border px-3 py-2 hover:bg-muted/40"
              >
                <div className="text-sm">{m.manifest.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">
                  rootId: {m.rootId}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const util = await getUtility(scope as UtilityScope, id, rootId);
  if (!util) notFound();
  const qs = rootId ? `?rootId=${encodeURIComponent(rootId)}` : "";
  return (
    <main className="flex-1 flex flex-col min-h-0">
      <header className="border-b px-6 py-3 flex items-start gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mt-0.5">
          <Link href="/utilities">
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("utilities.utilitiesLink")}
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium truncate flex items-center gap-2">
            {util.manifest.name}
            <Badge variant="outline" className="font-mono text-[10px]">
              v{util.manifest.version}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {util.scope}
            </Badge>
          </h1>
          {util.manifest.description && (
            <p className="text-xs text-muted-foreground truncate">
              {util.manifest.description}
            </p>
          )}
        </div>
        {util.manifest.source?.origin?.startsWith("github:") && (
          <Badge variant="outline" className="gap-1">
            <Github className="h-3 w-3" />
            <span className="font-mono">
              {util.manifest.source.origin.slice(7).split("@")[0]}
            </span>
          </Badge>
        )}
        <ShareButton
          kind="utility"
          utilityScope={util.scope}
          utilityId={util.manifest.id}
          {...(rootId ? { rootId } : {})}
          label={util.manifest.name}
        />
      </header>
      <Separator />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] min-h-0">
        <UtilityFrame
          scope={util.scope}
          id={util.manifest.id}
          utilityName={util.manifest.name}
          {...(rootId ? { rootId } : {})}
          {...(util.manifest.permissions.agent?.invoke && rootId
            ? { agentChat: true }
            : {})}
        />
        <aside className="border-l overflow-y-auto px-4 py-4 bg-muted/20">
          <ManifestPanel
            scope={util.scope}
            id={util.manifest.id}
            rootId={rootId}
            manifest={util.manifest}
            dir={util.dir}
          />
        </aside>
      </div>
    </main>
  );
}
