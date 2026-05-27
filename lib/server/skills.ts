import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { reflexHome } from "@/lib/reflex/home";

/**
 * "Skills" = reusable instruction packs the user (or agent) can apply to
 * a turn via `/skill <id>`. Each skill is a markdown file with YAML
 * frontmatter:
 *
 *   ---
 *   id: deep-research
 *   title: "Deep research"
 *   description: "Web + KB research with citations"
 *   author: builtin
 *   ---
 *   ## Instructions
 *   ...the agent reads this verbatim...
 *
 * Lookup order (first hit wins):
 *   1. `~/.reflex/skills/<id>.md`         (user-installed, persisted across projects)
 *   2. built-in skills bundled below
 *
 * Future: per-root skills, MCP-bound skills, skills with permission scopes.
 * For v1 the contract is intentionally tiny: it's just an instructions
 * blob the system prompt gets for that one turn.
 */

export interface SkillMeta {
  id: string;
  title: string;
  description: string;
  /** "builtin" for in-process skills, "user" for filesystem-installed. */
  author: "builtin" | "user";
}

export interface Skill extends SkillMeta {
  instructions: string;
}

const USER_DIR = path.join(reflexHome(), "skills");

const BUILTIN: Skill[] = [
  {
    id: "deep-research",
    title: "Deep research",
    description:
      "Deep research with citations - web + KB, synthesis via researcher sub-agents.",
    author: "builtin",
    instructions: [
      "## Skill: deep-research",
      "",
      "Run the investigation like a professional analyst:",
      "  1. First draft a short search plan: 3-5 key questions around the topic.",
      "  2. For each key question, dispatch a researcher sub-agent with a concrete brief and the expected output shape.",
      "  3. Once results come back, synthesize: what is confirmed, what conflicts, where the gaps are.",
      "  4. Cite sources with URL and date (when available). Never invent links.",
      "  5. At the end propose: (a) saving the key facts into KB (`<<reflex:kb>>` kind=\"research-note\"), (b) assembling a news-list/link-list widget.",
      "  6. If data is thin - say so openly and suggest next steps.",
    ].join("\n"),
  },
  {
    id: "widget-builder",
    title: "Widget builder",
    description:
      "Widget-creation helper - suggests the kind and data format.",
    author: "builtin",
    instructions: [
      "## Skill: widget-builder",
      "",
      "You help design and assemble a widget:",
      "  1. Clarify via `<<reflex:question>>` the widget's purpose and audience (for me alone / for the team / a report).",
      "  2. Pick the optimal `kind` - justify the choice out loud (one line).",
      "  3. If the widget needs data, gather it via WebFetch/WebSearch/Read before emitting.",
      "  4. Emit exactly one `<<reflex:widget-create>>` marker, with a thoughtful `id` and `refresh` cadence.",
      "  5. Tell the user how to edit the widget (pencil icon -> this same topic).",
    ].join("\n"),
  },
  {
    id: "kb-curator",
    title: "KB curator",
    description:
      "Turns raw content into clean KB notes with the right kind and meta.",
    author: "builtin",
    instructions: [
      "## Skill: kb-curator",
      "",
      "You are the knowledge-base curator. Every input - note, fact, or link - becomes a tidy KB entry:",
      "  1. Determine the `kind` (fact | task | meeting | product | person | place | event | ...). If ambiguous - ask.",
      "  2. Title: 4-9 words, no quotes, no trailing period.",
      "  3. `meta`: put structured fields here (ISO dates, links, tags). Do NOT duplicate them in the body.",
      "  4. `body`: anything that didn't fit in meta - context, nuance, quotes with sources.",
      "  5. Emit a `<<reflex:kb>>` marker; do not write via Write - the manager places it in the correct folder.",
      "  6. If the entry adds to an existing topic - mention sibling files via @-mentions in chat (for context, not for the agent).",
    ].join("\n"),
  },
];

export async function listSkills(): Promise<SkillMeta[]> {
  const user = await listUserSkills();
  const seen = new Set<string>(user.map((s) => s.id));
  const builtin = BUILTIN.filter((s) => !seen.has(s.id)).map(
    ({ instructions: _i, ...m }) => {
      void _i;
      return m;
    },
  );
  return [...user.map(({ instructions: _i, ...m }) => {
    void _i;
    return m;
  }), ...builtin];
}

async function listUserSkills(): Promise<Skill[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(USER_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(path.join(USER_DIR, e.name), "utf8");
      const parsed = matter(raw);
      const data = parsed.data as Partial<Skill>;
      const id = typeof data.id === "string" ? data.id : null;
      if (!id) continue;
      out.push({
        id,
        title: typeof data.title === "string" ? data.title : id,
        description:
          typeof data.description === "string" ? data.description : "",
        author: "user",
        instructions: parsed.content.trim(),
      });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function loadSkill(id: string): Promise<Skill | null> {
  const user = await listUserSkills();
  const hit = user.find((s) => s.id === id);
  if (hit) return hit;
  return BUILTIN.find((s) => s.id === id) ?? null;
}
