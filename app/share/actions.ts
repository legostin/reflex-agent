"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getShare, verifyPassword } from "@/lib/server/shares/store";

/**
 * Validate the supplied password and, on success, set a long-lived
 * httpOnly cookie scoped to this share id. Then redirect back to the
 * canonical /share/<id> URL — the page reads the cookie next render.
 */
export async function submitSharePasswordAction(
  shareId: string,
  password: string,
): Promise<void> {
  const share = await getShare(shareId);
  if (!share) redirect("/share/" + encodeURIComponent(shareId));
  if (!verifyPassword(share, password)) {
    redirect(`/share/${encodeURIComponent(shareId)}?error=bad`);
  }
  const jar = await cookies();
  jar.set(`reflex_share_${shareId}`, password, {
    httpOnly: true,
    sameSite: "lax",
    path: "/share",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/share/" + encodeURIComponent(shareId));
}
