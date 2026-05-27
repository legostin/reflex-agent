import { NextRequest } from "next/server";
import { completeAuthorize } from "@/lib/server/oauth/flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * OAuth redirect URI. Browser arrives here from the vendor's consent screen.
 * We exchange the code for tokens, persist them under
 * `~/.reflex/oauth/tokens/<provider>.json`, then render a tiny success page
 * the user closes manually (the original Reflex tab stays open).
 *
 * Note: the vendor may also redirect with `?error=…` if the user denied.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  if (errorParam) {
    return htmlResponse(
      errorPage(
        `OAuth ${errorParam}`,
        errorDescription ?? "Vendor returned an error — try again.",
      ),
      400,
    );
  }
  if (!code || !state) {
    return htmlResponse(
      errorPage("Missing parameters", "Both `code` and `state` are required."),
      400,
    );
  }
  try {
    const { provider } = await completeAuthorize(state, code);
    return htmlResponse(successPage(provider));
  } catch (err) {
    return htmlResponse(
      errorPage(
        "Authorization failed",
        err instanceof Error ? err.message : String(err),
      ),
      500,
    );
  }
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { max-width: 520px; width: 100%; padding: 24px; border: 1px solid rgba(127,127,127,0.3); border-radius: 12px; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.15); }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p  { margin: 6px 0; color: rgba(127,127,127,1); font-size: 14px; line-height: 1.45; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 1px 4px; background: rgba(127,127,127,0.12); border-radius: 4px; }
  .ok { color: #059669; }
  .bad { color: #dc2626; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function successPage(provider: string): string {
  return shell(
    `${provider} authorized`,
    `<h1 class="ok">✓ ${provider} authorized</h1>
     <p>Tokens saved to <code>~/.reflex/oauth/tokens/${provider}.json</code>.</p>
     <p>You can close this tab and return to Reflex.</p>`,
  );
}

function errorPage(title: string, message: string): string {
  return shell(
    title,
    `<h1 class="bad">${escapeHtml(title)}</h1>
     <p>${escapeHtml(message)}</p>
     <p>Close this tab and retry authorization from Settings.</p>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
