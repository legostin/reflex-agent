import { describe, it, expect } from "vitest";
import {
  sanitizeIdStrip,
  sanitizeIdDash,
  slugify,
  slugifyUnicode,
  slugifyHandle,
} from "@/lib/reflex/ids";

/**
 * Byte-identical guard for the id-sanitizer consolidation. Each named export
 * must produce EXACTLY what the original inline implementation did — otherwise
 * existing on-disk files silently get renamed/orphaned on upgrade. The
 * `original*` fns below are verbatim copies of the pre-consolidation code.
 */

// --- verbatim originals ---
const origStrip = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, ""); // topics.ts
const origDash = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80); // widgets+workflows
const origSlug = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60); // tasks/store.ts
const origUnicode = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60); // kb-writer.ts
const origHandle = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64); // skills.ts

const SAMPLES = [
  "",
  "hello",
  "Hello World",
  "  spaced  ",
  "Привет Мир",
  "café déjà",
  "weird/../path\\x",
  "UPPER_snake-Case",
  "emoji 🎉 test",
  "--leading-and-trailing--",
  "a".repeat(120),
  "Über Café 2024 — Q3 Report!",
  "tabs\tand\nnewlines",
  "id_with.dots.and-dashes",
  "中文 标题 test",
];

describe("id sanitizers are byte-identical to their originals", () => {
  it("sanitizeIdStrip === topics original", () => {
    for (const s of SAMPLES) expect(sanitizeIdStrip(s)).toBe(origStrip(s));
  });
  it("sanitizeIdDash === widgets/workflows original", () => {
    for (const s of SAMPLES) expect(sanitizeIdDash(s)).toBe(origDash(s));
  });
  it("slugify === tasks original", () => {
    for (const s of SAMPLES) expect(slugify(s)).toBe(origSlug(s));
  });
  it("slugifyUnicode === kb-writer original", () => {
    for (const s of SAMPLES) expect(slugifyUnicode(s)).toBe(origUnicode(s));
  });
  it("slugifyHandle === skills original", () => {
    for (const s of SAMPLES) expect(slugifyHandle(s)).toBe(origHandle(s));
  });

  it("the variants are genuinely distinct (not accidentally mergeable)", () => {
    // unicode vs ascii diverge on non-ASCII; dash vs strip on disallowed chars.
    expect(slugifyUnicode("Привет")).not.toBe(slugify("Привет"));
    expect(sanitizeIdDash("a/b")).not.toBe(sanitizeIdStrip("a/b"));
  });
});
