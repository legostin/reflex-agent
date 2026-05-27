import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow server components/actions in our local app to spawn child processes
  // and interact with the local filesystem.
  serverExternalPackages: [
    "chokidar",
    "execa",
    "esbuild",
    "sharp",
    "@tailwindcss/node",
    "@tailwindcss/oxide",
    "tailwindcss",
    "lightningcss",
  ],
  // The shared `lib/reflex/` modules use `.js` extensions in their imports
  // (required by Node's NodeNext resolver for the CLI build). Tell webpack
  // and Turbopack to fall back to `.ts`/`.tsx` when resolving them.
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
    resolveAlias: {},
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
