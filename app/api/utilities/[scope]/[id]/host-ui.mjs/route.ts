import { NextResponse } from "next/server";
import * as esbuild from "esbuild";
import path from "node:path";
import { HOST_UI_SOURCE } from "@/lib/server/utilities/host-ui-source";

export const dynamic = "force-static";
export const runtime = "nodejs";

/**
 * Serves the `@host/ui` module to utility iframes. The raw source (with
 * `import "react"`) is bundled with esbuild so React is inlined — utilities
 * resolve `@host/ui` via the iframe importmap and load a fully self-contained
 * ESM module. See `lib/server/utilities/host-ui-source.ts` for the source.
 */

let cachedBundle: string | null = null;

async function bundledSource(): Promise<string> {
  if (cachedBundle) return cachedBundle;
  const result = await esbuild.build({
    stdin: {
      contents: HOST_UI_SOURCE,
      resolveDir: path.join(process.cwd(), "node_modules"),
      sourcefile: "host-ui.mjs",
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  if (result.errors.length > 0) {
    throw new Error(
      "host-ui bundle failed: " +
        result.errors.map((e) => e.text).join("; "),
    );
  }
  cachedBundle = result.outputFiles[0].text;
  return cachedBundle;
}

export async function GET(): Promise<Response> {
  const code = await bundledSource();
  return new NextResponse(code, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
