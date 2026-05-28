/**
 * Canonical id / slug sanitizers for Reflex (north-star SpaceStore, Layer 1).
 *
 * Historically every store rolled its own. These are the SAME implementations,
 * gathered in one place so the variants are named and discoverable. They are
 * deliberately NOT collapsed into one parameterized function: the behaviors
 * differ in subtle ways (allowed charset, ASCII vs unicode, length cap, whether
 * existing dashes survive) and merging them would silently rename existing
 * on-disk files. Cohesion of location, not of implementation.
 *
 * Pure, dependency-free (so it compiles cleanly under both the app and CLI
 * tsconfigs and sits at the bottom of the import-direction graph).
 */

/**
 * Strip everything except `[A-Za-z0-9_-]` (no replacement, no length cap).
 * Topic ids — a filename must round-trip an externally supplied id without
 * changing its length. (was: lib/server/topics.ts)
 */
export function sanitizeIdStrip(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Replace disallowed chars with `-` and cap at 80. Widget + workflow ids
 * (agent-authored, kebab-ish). (was: lib/server/widgets/store.ts,
 * lib/server/workflows/store.ts — identical)
 */
export function sanitizeIdDash(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

/**
 * NFKD + lowercase ASCII slug, trimmed of leading/trailing dashes, capped at
 * 60. Task ids. (was: lib/server/tasks/store.ts)
 */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * NFKD + lowercase UNICODE-aware slug (keeps non-ASCII letters/numbers),
 * trimmed, capped at 60. KB filenames. (was: lib/server/agents/kb-writer.ts)
 */
export function slugifyUnicode(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Trim + lowercase, collapse to `[a-z0-9-]` (existing dashes preserved, no
 * NFKD), trimmed, capped at 64. Skill handles. (was: lib/server/skills.ts)
 */
export function slugifyHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
