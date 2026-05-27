import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { getRoot } from "@/lib/registry";
import { readKbFile } from "@/lib/server/kb";
import {
  getShare,
  shareExpired,
  verifyPassword,
} from "@/lib/server/shares/store";
import { SharedKbView } from "../../_components/shared-kb-view";

/**
 * Sub-route for the `kb-tree` share kind. The tree-index page links here
 * with `?rel=<path>` and we render the matching file behind the same
 * password gate. Single share id keeps the auth boundary for the whole
 * tree — once unlocked, browse freely.
 */
export const dynamic = "force-dynamic";

export default async function SharedKbFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rel?: string }>;
}) {
  const { id } = await params;
  const { rel } = await searchParams;
  if (!rel) notFound();
  const share = await getShare(id);
  if (!share || share.kind !== "kb-tree") notFound();
  if (shareExpired(share)) notFound();
  if (!share.rootId) notFound();
  const cookieJar = await cookies();
  const cookiePw = cookieJar.get(`reflex_share_${id}`)?.value ?? "";
  if (share.passwordHash && !verifyPassword(share, cookiePw)) notFound();
  const entry = await getRoot(share.rootId);
  if (!entry) notFound();
  const content = await readKbFile(entry.path, rel).catch(() => null);
  if (content == null) notFound();
  return (
    <div>
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <Link
          href={`/share/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-violet-700"
        >
          <ArrowLeft className="h-3 w-3" />
          Назад к списку
        </Link>
      </div>
      <SharedKbView path={rel} content={content} rootLabel={entry.path} />
    </div>
  );
}
