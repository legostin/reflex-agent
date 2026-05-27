import { promises as fs } from "node:fs";
import path from "node:path";
import { reflexHome } from "../home.js";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_NAMES,
  type TemplateName,
} from "./defaults.js";

const PROMPTS_DIR = path.join(reflexHome(), "prompts");

function pathFor(name: TemplateName): string {
  return path.join(PROMPTS_DIR, `${name}.md`);
}

function isTemplateName(s: string): s is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(s);
}

export function templatePath(name: TemplateName): string {
  return pathFor(name);
}

/**
 * Load `<name>` template body. If the file is missing, scaffold it with the
 * built-in default and return that. Always returns the on-disk content after
 * the call so subsequent reads see the same bytes.
 */
export async function loadTemplate(name: TemplateName): Promise<string> {
  const target = pathFor(name);
  try {
    return await fs.readFile(target, "utf8");
  } catch (err: unknown) {
    if (!isNotFound(err)) throw err;
  }
  // First touch — write the default so the user can edit on disk too.
  await fs.mkdir(PROMPTS_DIR, { recursive: true });
  await fs.writeFile(target, DEFAULT_TEMPLATES[name], "utf8");
  return DEFAULT_TEMPLATES[name];
}

export async function saveTemplate(
  name: TemplateName,
  body: string,
): Promise<void> {
  await fs.mkdir(PROMPTS_DIR, { recursive: true });
  await fs.writeFile(pathFor(name), body, "utf8");
}

export async function resetTemplate(name: TemplateName): Promise<string> {
  await saveTemplate(name, DEFAULT_TEMPLATES[name]);
  return DEFAULT_TEMPLATES[name];
}

export function assertTemplateName(s: string): TemplateName {
  if (!isTemplateName(s)) {
    throw new Error(`Unknown template: ${s}`);
  }
  return s;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
