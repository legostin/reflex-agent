import { NextRequest, NextResponse } from "next/server";

/**
 * Host gate for the ngrok-exposed surface. When Reflex's settings have an
 * active tunnel, `process.env.REFLEX_NGROK_HOST` is set on tunnel start
 * (see `lib/server/ngrok/actions.ts`). Requests arriving on that host are
 * only allowed to read the public `/share/*` and `/api/utilities/*`
 * surface that those share pages embed; everything else returns 403 so
 * the management UI never leaks over the tunnel.
 *
 * Localhost is always permissive — the gate only fires when the Host
 * header matches the configured public domain.
 */
const PUBLIC_PREFIXES = [
  "/share",
  "/api/utilities", // utility iframes / bundles needed by SharedUtilityView
  "/_next",
  "/favicon",
];

function isPublicPath(pathname: string): boolean {
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const ngrokHost = process.env.REFLEX_NGROK_HOST ?? "";
  // No tunnel active or request from somewhere else (localhost, LAN): pass.
  if (!ngrokHost || host.toLowerCase() !== ngrokHost.toLowerCase()) {
    return NextResponse.next();
  }
  if (isPublicPath(req.nextUrl.pathname)) {
    const res = NextResponse.next();
    // ngrok's free-tier interstitial warning page breaks iframe loads.
    // Setting this response header suppresses it for every public path
    // (the request header path also works, but iframes can't set headers).
    res.headers.set("ngrok-skip-browser-warning", "1");
    return res;
  }
  return new NextResponse(
    "Forbidden: this Reflex instance is exposed via ngrok only for shared links.",
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
