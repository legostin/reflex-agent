import { NextRequest, NextResponse } from "next/server";
import { getUtility } from "@/lib/server/utilities/store";
import type { UtilityScope } from "@/lib/server/utilities/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the HTML shell that hosts a utility. CSP forbids any direct network
 * use from inside the iframe — all I/O routes back to the parent through
 * `postMessage` → `/api/utilities/.../host`.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ scope: string; id: string }> },
): Promise<Response> {
  const { scope, id } = await ctx.params;
  const rootId = req.nextUrl.searchParams.get("rootId") ?? undefined;
  if (scope !== "global" && scope !== "project") {
    return new NextResponse("Bad scope", { status: 400 });
  }
  const util = await getUtility(scope as UtilityScope, id, rootId ?? undefined);
  if (!util) return new NextResponse("Utility not found", { status: 404 });

  const base = `/api/utilities/${scope}/${id}`;
  const qs = rootId ? `?rootId=${encodeURIComponent(rootId)}` : "";
  // User-approved external image hosts (manifest.permissions.images.domains)
  // are appended to img-src so the iframe can render them directly. We
  // re-validate each host here — never trust the manifest blindly into a
  // CSP string, or a crafted entry could break out of the directive.
  const imgHosts = (util.manifest.permissions.images?.domains ?? [])
    .filter(isSafeCspHost)
    .map((h) => `https://${h}`);
  const imgSrc = ["'self'", "data:", "blob:", ...imgHosts].join(" ");
  const csp = [
    "default-src 'self'",
    "connect-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
  ].join("; ");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
  <title>${escapeHtml(util.manifest.name)}</title>
  <link rel="stylesheet" href="${base}/style.css${qs}" />
  <script type="importmap">
    {
      "imports": {
        "@host/api": "${base}/host-api.mjs${qs}",
        "@host/ui": "${base}/host-ui.mjs${qs}"
      }
    }
  </script>
</head>
<body class="bg-white text-slate-900 antialiased">
  <div id="root"></div>
  <script type="module" src="${base}/bundle.js${qs}"></script>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      // Suppress the ngrok free-tier interstitial warning page so the
      // iframe loads our actual HTML, not the "Visit Site" prompt.
      "ngrok-skip-browser-warning": "1",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Defence-in-depth: the manifest schema already constrains the host
 * shape, but a CSP directive is a space/semicolon-delimited grammar, so
 * we reject any host containing a character that could terminate the
 * `img-src` directive and inject another (spaces, ';', quotes, etc.).
 * Allows bare hostnames with an optional leading `*.` wildcard.
 */
function isSafeCspHost(host: string): boolean {
  return /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    host,
  );
}
