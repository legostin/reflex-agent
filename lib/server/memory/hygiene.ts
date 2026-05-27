import "server-only";

/**
 * Pre-write hygiene for memory entries.
 *
 * Memory is loaded into every system prompt — anything written here
 * effectively becomes part of the agent's "self". That makes the path
 * a high-value target for accidental or hostile content:
 *
 * - Prompt-injection payloads pasted from chat threads or scraped pages.
 *   `<system>…</system>` and `[INST]…[/INST]` are the obvious shapes; we
 *   refuse them outright rather than try to neutralise them.
 * - Credentials. Tokens that look like API keys (sk-…, ghp_, eyJ JWTs,
 *   AKIA AWS access keys) almost never belong here — the agent gets them
 *   from secrets, not memory.
 * - Invisible / RTL unicode. Zero-width chars and bidi overrides have
 *   been used to smuggle text past human review. Strip would be a
 *   silent edit; reject is honest.
 * - Exact-duplicate lines. The append path checks against the file's
 *   current content so the same fact doesn't accumulate.
 */

const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "system-tag", re: /<\s*\/?\s*system\b[^>]*>/i },
  { name: "user-tag", re: /<\s*\/?\s*user\b[^>]*>/i },
  { name: "assistant-tag", re: /<\s*\/?\s*assistant\b[^>]*>/i },
  { name: "inst-marker", re: /\[\s*\/?\s*INST\s*\]/i },
  { name: "im-start", re: /<\|im_(?:start|end)\|>/ },
  { name: "reflex-marker", re: /<<\s*reflex\s*:/i },
];

const CREDENTIAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "sk-token", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  { name: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

// Zero-width / soft-hyphen / bidi overrides / variation selectors / tag chars.
// Newline (U+000A) is obviously fine; we only ban the truly invisible bunch.
// Explicit codepoint escapes so the source file stays ASCII-only.
const INVISIBLE_UNICODE_RE = new RegExp(
  "[" +
    "\\u00AD" + // soft hyphen
    "\\u200B-\\u200F" + // zero-width space, joiners, LRM/RLM
    "\\u202A-\\u202E" + // bidi overrides
    "\\u2060-\\u2064" + // word joiner, invisible ops
    "\\u206A-\\u206F" + // deprecated formatting
    "\\uFEFF" + // BOM / zero-width no-break space
    "]|" +
    // Unicode TAG block (U+E0000–U+E007F) — historically used to smuggle text.
    "[\\u{E0000}-\\u{E007F}]",
  "u",
);

export interface HygieneResult {
  ok: boolean;
  error?: string;
}

export interface HygieneOptions {
  /** Existing file content — used for the duplicate-line check on appends. */
  existing?: string | null;
  /** Skip the duplicate-line check (e.g. for `replace`, where the whole file is replaced). */
  skipDupCheck?: boolean;
}

export function checkMemoryHygiene(
  input: string,
  opts: HygieneOptions = {},
): HygieneResult {
  const text = input ?? "";
  if (!text.trim()) {
    return { ok: false, error: "empty content" };
  }

  for (const { name, re } of INJECTION_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        error: `looks like a prompt-injection payload (${name}). Strip the wrapper and try again.`,
      };
    }
  }

  for (const { name, re } of CREDENTIAL_PATTERNS) {
    if (re.test(text)) {
      return {
        ok: false,
        error: `looks like a credential (${name}). Memory is not a secret store — save the credential through Reflex secrets instead.`,
      };
    }
  }

  if (INVISIBLE_UNICODE_RE.test(text)) {
    return {
      ok: false,
      error:
        "contains invisible / bidi unicode characters. Paste as plain text and try again.",
    };
  }

  if (!opts.skipDupCheck && opts.existing) {
    const existingLines = new Set(
      opts.existing
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const newLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (newLines.length > 0 && newLines.every((l) => existingLines.has(l))) {
      return {
        ok: false,
        error: "every line is already present — nothing to add.",
      };
    }
  }

  return { ok: true };
}
