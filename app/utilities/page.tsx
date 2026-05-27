import Link from "next/link";
import { Boxes, FolderPlus, Github, Shield, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { listUtilities } from "@/lib/server/utilities/store";
import { listRoots } from "@/lib/registry";
import { InstallFromGithubButton } from "./_components/install-from-github-button";
import { InstallFromMcpButton } from "./_components/install-from-mcp-button";
import { InstallViaAgentButton } from "./_components/install-via-agent-button";
import { RemoveUtilityButton } from "./_components/remove-utility-button";
import { CuratedGallery } from "./_components/curated-gallery";
import { loadSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

export default async function UtilitiesPage() {
  const [utilities, settings, roots] = await Promise.all([
    listUtilities({}),
    loadSettings(),
    listRoots(),
  ]);
  const globals = utilities.filter((u) => u.scope === "global");
  const projects = utilities.filter((u) => u.scope === "project");
  const installedIds = new Set(utilities.map((u) => u.manifest.id));
  const spaces = roots.map((r) => ({
    id: r.id,
    label: r.path.split("/").filter(Boolean).pop() ?? r.path,
  }));
  const advanced = settings.uiMode === "advanced";
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Мини-приложения</h1>
          <p className="text-muted-foreground mt-1">
            Готовый каталог + кастомные. Все запросы наружу идут через Reflex
            и логируются в аудит.
          </p>
        </div>
        {advanced && (
          <div className="flex flex-wrap gap-2">
            <InstallFromGithubButton />
            <InstallFromMcpButton />
            <InstallViaAgentButton />
          </div>
        )}
      </header>

      <section className="mb-8 space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Каталог</h2>
        <p className="text-xs text-muted-foreground">
          Кураторская подборка. Жми «Установить» — Reflex скачает и проверит
          разрешения автоматически.
        </p>
        <CuratedGallery installedIds={installedIds} spaces={spaces} />
      </section>

      <Separator className="my-6" />

      <Section title="Установленные" hint={`${utilities.length} штук`} utilities={[...projects, ...globals]} />
      {advanced && (
        <>
          <Separator className="my-8" />
          <Section title="Глобальные" hint="~/.reflex/utilities/" utilities={globals} />
          <Separator className="my-8" />
          <Section
            title="Проектные"
            hint="<root>/.reflex/utilities/ — видны только в своём проекте"
            utilities={projects}
          />
        </>
      )}
    </main>
  );
}

function Section({
  title,
  hint,
  utilities,
}: {
  title: string;
  hint: string;
  utilities: Awaited<ReturnType<typeof listUtilities>>;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {utilities.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Пока пусто. Попроси агента сделать утилиту или установи готовую из GitHub.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {utilities.map((u) => (
            <Card key={`${u.scope}:${u.rootId ?? ""}:${u.manifest.id}`} className="group">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Boxes className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{u.manifest.name}</span>
                  <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                    v{u.manifest.version}
                  </Badge>
                </CardTitle>
                <CardDescription className="line-clamp-2">
                  {u.manifest.description || "нет описания"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-xs">
                {u.manifest.source?.origin?.startsWith("github:") && (
                  <Badge variant="secondary" className="gap-1">
                    <Github className="h-3 w-3" />
                    {u.manifest.source.origin.slice(7, u.manifest.source.origin.indexOf("@"))}
                  </Badge>
                )}
                {u.manifest.source?.type === "mcp" && (
                  <Badge variant="secondary">MCP</Badge>
                )}
                {u.manifest.source?.type === "agent" && (
                  <Badge variant="outline">создано агентом</Badge>
                )}
                {!u.bundleAvailable && (
                  <Badge variant="destructive" className="gap-1">
                    <Shield className="h-3 w-3" /> bundle missing
                  </Badge>
                )}
                {(u.manifest.serverActions?.length ?? 0) > 0 && (
                  <Badge variant="outline">
                    workers: {u.manifest.serverActions.length}
                  </Badge>
                )}
                <div className="ml-auto flex gap-1">
                  <Button asChild size="sm" variant="default">
                    <Link href={`/utilities/${u.scope}/${u.manifest.id}${u.rootId ? `?rootId=${u.rootId}` : ""}`}>
                      Открыть
                    </Link>
                  </Button>
                  <RemoveUtilityButton
                    scope={u.scope}
                    id={u.manifest.id}
                    name={u.manifest.name}
                    {...(u.rootId ? { rootId: u.rootId } : {})}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
