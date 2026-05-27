"use server";

import {
  assertTemplateName,
  loadTemplate,
  resetTemplate,
  saveTemplate,
  templatePath,
} from "@/lib/reflex/prompts/store";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_LABELS,
  TEMPLATE_VARIABLES,
  type TemplateName,
} from "@/lib/reflex/prompts/defaults";

export type LoadTemplateResult =
  | {
      ok: true;
      name: TemplateName;
      body: string;
      defaultBody: string;
      missingSections: string[];
      path: string;
      variables: string[];
    }
  | { ok: false; error: string };

export async function loadTemplateAction(
  name: string,
): Promise<LoadTemplateResult> {
  try {
    const n = assertTemplateName(name);
    const body = await loadTemplate(n);
    const defaultBody = DEFAULT_TEMPLATES[n];
    return {
      ok: true,
      name: n,
      body,
      defaultBody,
      missingSections: missingMarkdownSections(body, defaultBody),
      path: templatePath(n),
      variables: TEMPLATE_VARIABLES[n],
    };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/**
 * Append sections (top-level `## ` markdown headings) that exist in the
 * built-in template but not in the user's local copy. Sections the user has
 * already customized are left untouched — only fresh content is added.
 */
export async function mergeTemplateAction(
  name: string,
): Promise<{ ok: true; body: string; appended: string[] } | { ok: false; error: string }> {
  try {
    const n = assertTemplateName(name);
    const current = await loadTemplate(n);
    const def = DEFAULT_TEMPLATES[n];
    const missing = missingMarkdownSections(current, def);
    if (missing.length === 0) {
      return { ok: true, body: current, appended: [] };
    }
    const blocks = extractSections(def);
    const appended: string[] = [];
    let body = current.trimEnd();
    for (const h of missing) {
      const block = blocks.get(h);
      if (!block) continue;
      body += "\n\n" + block.trim();
      appended.push(h);
    }
    body += "\n";
    await saveTemplate(n, body);
    return { ok: true, body, appended };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/**
 * Split a markdown body into top-level `## Heading` sections. Returns a map
 * heading-text → full block (heading + body up to the next `## ` or EOF).
 * Anything before the first `## ` is keyed as the empty string.
 */
function extractSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let currentHeading = "";
  let buffer: string[] = [];
  const flush = () => {
    const joined = buffer.join("\n");
    if (joined.trim().length > 0 || currentHeading) {
      sections.set(currentHeading, joined);
    }
    buffer = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentHeading = m[1]!.trim();
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function missingMarkdownSections(userBody: string, defaultBody: string): string[] {
  const userHeadings = new Set(extractSections(userBody).keys());
  const out: string[] = [];
  for (const h of extractSections(defaultBody).keys()) {
    if (!h) continue; // pre-heading preamble
    if (!userHeadings.has(h)) out.push(h);
  }
  return out;
}

export async function saveTemplateAction(
  name: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const n = assertTemplateName(name);
    await saveTemplate(n, body);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function resetTemplateAction(
  name: string,
): Promise<{ ok: boolean; body?: string; error?: string }> {
  try {
    const n = assertTemplateName(name);
    const body = await resetTemplate(n);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function listTemplatesAction(): Promise<
  Array<{ name: TemplateName; label: string; variables: string[] }>
> {
  return TEMPLATE_NAMES.map((n) => ({
    name: n,
    label: TEMPLATE_LABELS[n],
    variables: TEMPLATE_VARIABLES[n],
  }));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
