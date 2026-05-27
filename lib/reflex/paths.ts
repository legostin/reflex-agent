import path from "node:path";

export const REFLEX_DIR = ".reflex";
export const REFLEX_IGNORE = ".reflexignore";
export const REFLEX_CONFIG = "config.json";
export const INDEX_MD = "INDEX.md";

export const DEFAULT_PRUNE = new Set([
  ".reflex",
  ".git",
  "node_modules",
  ".DS_Store",
]);

/** Default debounce: 30 minutes. */
export const DEFAULT_DEBOUNCE_MS = 30 * 60 * 1000;
/** Minimum debounce: 1 second (prevents thrash; the user-meaningful floor is configured via settings). */
export const MIN_DEBOUNCE_MS = 1000;

export function reflexRoot(root: string): string {
  return path.join(root, REFLEX_DIR);
}

export function configPath(root: string): string {
  return path.join(reflexRoot(root), REFLEX_CONFIG);
}

export function rootIndexPath(root: string): string {
  return path.join(reflexRoot(root), INDEX_MD);
}

/** Mirror a directory's relative path inside .reflex/. */
export function mirrorInReflex(root: string, relDir: string): string {
  return path.join(reflexRoot(root), relDir);
}

/** INDEX.md location for a given subdir (relative to root). */
export function subdirIndexPath(root: string, relDir: string): string {
  return path.join(mirrorInReflex(root, relDir), INDEX_MD);
}
