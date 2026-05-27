import { notFound } from "next/navigation";
import { Lock, Share2 } from "lucide-react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getRoot } from "@/lib/registry";
import { getShare, shareExpired, touchShare, verifyPassword } from "@/lib/server/shares/store";
import { readKbFile, walkKbMarkdown } from "@/lib/server/kb";
import { getUtility } from "@/lib/server/utilities/store";
import { listWidgets, readLayout } from "@/lib/server/widgets/store";
import { ShareAuthForm } from "../_components/share-auth-form";
import { SharedKbView } from "../_components/shared-kb-view";
import { SharedUtilityView } from "../_components/shared-utility-view";
import { SharedProjectView } from "../_components/shared-project-view";
import { SharedKbTreeView } from "../_components/shared-kb-tree-view";

/**
 * Public, read-only entry point for any artifact that's been shared via
 * the Reflex `Share` UI. Auth: optional per-share password stored as a
 * cookie (`reflex_share_<id>=<password>`). When no password is set on
 * the share, the URL itself is the only secret.
 *
 * Renders one of four views depending on the share's kind. Nothing on
 * this page reaches into the project's writable surface — KB files come
 * from the read-only `readKbFile`, dashboards are static.
 */
export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pw?: string; error?: string }>;
}) {
  const { id } = await params;
  const { pw, error } = await searchParams;
  const share = await getShare(id);
  if (!share) notFound();
  const t = await getTranslations("app");
  if (shareExpired(share)) {
    return (
      <ShareGoneFrame>
        <p className="text-sm text-muted-foreground">
          {t("share.page.expired")}
        </p>
      </ShareGoneFrame>
    );
  }
  // Resolve password: query overrides cookie (lets a user fix a stale cookie
  // by re-pasting the URL with ?pw=...).
  const cookieJar = await cookies();
  const cookiePw = cookieJar.get(`reflex_share_${id}`)?.value;
  const provided = pw ?? cookiePw ?? "";
  if (share.passwordHash && !verifyPassword(share, provided)) {
    return (
      <ShareGoneFrame title={t("share.page.needPassword")}>
        <ShareAuthForm shareId={id} {...(error ? { error } : {})} />
      </ShareGoneFrame>
    );
  }
  // Mark accessed (fire-and-forget; share rendering doesn't depend on it).
  void touchShare(id);

  if (share.kind === "utility") {
    if (!share.utilityScope || !share.utilityId) notFound();
    const util = await getUtility(
      share.utilityScope,
      share.utilityId,
      share.rootId,
    );
    if (!util) notFound();
    return (
      <SharedUtilityView
        scope={util.scope}
        id={util.manifest.id}
        {...(share.rootId ? { rootId: share.rootId } : {})}
        manifest={util.manifest}
      />
    );
  }
  if (share.kind === "kb-file") {
    if (!share.rootId || !share.kbRelPath) notFound();
    const entry = await getRoot(share.rootId);
    if (!entry) notFound();
    const content = await readKbFile(entry.path, share.kbRelPath).catch(
      () => null,
    );
    if (content == null) notFound();
    return (
      <SharedKbView
        path={share.kbRelPath}
        content={content}
        rootLabel={entry.path}
      />
    );
  }
  if (share.kind === "kb-tree") {
    if (!share.rootId) notFound();
    const entry = await getRoot(share.rootId);
    if (!entry) notFound();
    const files = await walkKbMarkdown(entry.path);
    return (
      <SharedKbTreeView
        rootPath={entry.path}
        files={files.map((f) => ({
          rel: f.rel,
          size: f.size,
          modifiedAt: f.modifiedAt,
        }))}
        shareId={id}
      />
    );
  }
  if (share.kind === "project") {
    if (!share.rootId) notFound();
    const entry = await getRoot(share.rootId);
    if (!entry) notFound();
    const widgets = await listWidgets(entry.path);
    const layout = await readLayout(entry.path);
    return (
      <SharedProjectView
        rootPath={entry.path}
        widgets={widgets}
        layout={layout}
      />
    );
  }
  notFound();
}

async function ShareGoneFrame({
  title = "Reflex Share",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("app");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-muted/20 px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4" />
          {title}
        </div>
        {children}
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Share2 className="h-3 w-3" />
          {t("share.page.footer")}
        </p>
      </div>
    </main>
  );
}
