# Reflex — local-first AI agent + knowledge base for your files

**Reflex turns any folder into a second brain run by an AI agent.** Point it at
a directory, and Claude Code or OpenAI Codex maintains a living knowledge base,
remembers every conversation, runs scheduled workflows in the background, and
dispatches sub-tasks in isolated git worktrees — all stored as plain markdown on
your machine. No cloud, no database, no daemon.

[![npm](https://img.shields.io/npm/v/reflex-agent.svg)](https://www.npmjs.com/package/reflex-agent)
![Node](https://img.shields.io/badge/node-%E2%89%A522-3c873a.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```sh
npm i -g reflex-agent
reflex start          # opens the web UI at http://localhost:3210
```

> **Local-first AI assistant · personal knowledge management (PKM) · second
> brain · autonomous agent platform.** Your notes, chats, and automations live
> in your filesystem as markdown you can read, grep, and version-control —
> Reflex just makes an agent fluent in them.

---

## Why Reflex?

A cloud chatbot forgets you between sessions, can't act while you're away, and
keeps your data on someone else's server. Reflex is built the other way around:

- **Local-first & private.** Everything is markdown + JSON under your control.
  Network access is opt-in (LLM calls, web fetch, GitHub installs); Reflex
  browses and reads fully offline.
- **Persistent memory & recall.** A durable per-project memory plus full-text
  search over *every* past conversation — the agent never re-asks who you are.
- **Autonomous by schedule.** Background workflows wake on their own clock
  (hourly / daily / weekly) and do work without you in the loop.
- **A platform, not a prompt.** Installable mini-app **utilities** add UI,
  commands, skills, and automations — and can securely share data with each
  other through a permissioned, audited grant system.
- **Bring your own agent.** Runs on **Claude Code** or **OpenAI Codex**, with
  **MCP** servers as on-demand tools.

## Quickstart

**Prerequisites**

- **Node.js 22+** ([nodejs.org](https://nodejs.org/) or `nvm`/`fnm`). Node 24
  recommended — its built-in SQLite powers conversation search.
- An authenticated coding-agent CLI:
  - `npm i -g @openai/codex && codex login`, or
  - `npm i -g @anthropic-ai/claude-code && claude login`

**Install & run**

```sh
npm i -g reflex-agent          # or: pnpm add -g reflex-agent
reflex start                   # http://localhost:3210
reflex start --port 4000 --no-open
```

**First run**

1. Click **Add a root** and pick a directory — that folder becomes a *Space*.
2. The onboarding wizard seeds memory and suggests a first workflow.
3. Open a chat and type in plain language. The agent reads/writes the
   `.reflex/` tree, your memory files, and (with permission) shell + web tools.

## Features

### 📚 A knowledge base per Space

The agent builds a tree of markdown notes under `<your-dir>/.reflex/`:

```
<your-dir>/
├── .reflexignore        — gitignore-syntax — same rules
└── .reflex/
    ├── INDEX.md         — top-level summary
    ├── kb/              — categorised entries (note, article, diagram, …)
    ├── memory/          — eight files describing the user / project
    ├── topics/          — chat transcripts
    ├── journal/         — daily entries
    ├── workflows/       — saved recipes
    ├── utilities/       — locally-installed extensions
    └── worktrees/       — task-bound git worktrees
```

See [docs/kb.md](docs/kb.md) and [docs/architecture.md](docs/architecture.md).

### 🧠 Cross-session memory

Eight bounded markdown files capture who you are and what the project is about,
loaded into every chat's system prompt. A weekly task rolls up the journal into
a summary; a hygiene scanner refuses writes that look like prompt injection,
credentials, or invisible unicode. See [docs/memory.md](docs/memory.md).

### 🔎 Searchable conversation history

Every journal entry and chat transcript across every Space is indexed into a
SQLite **FTS5** database. Ask *"what did we decide about X?"* and get
ranked snippets in milliseconds — the substrate for true long-term recall.
See [docs/sessions.md](docs/sessions.md).

### ⏰ Scheduled, autonomous workflows

Compose "recipes" from typed steps — `web-fetch`, `ask-agent`, `kb-write`,
`image-generate`, `notify`, and more. The in-process scheduler fires triggered
workflows hourly / daily / weekly, so the agent acts while you're away.
See [docs/workflows.md](docs/workflows.md).

### 🧩 Installable utilities + the Share Plane

Utilities are mini-apps that bundle a UI iframe, server actions, slash commands,
skills, system-prompt addenda, and workflows — shipped curated or installed from
GitHub. They can **share data with each other** through the **Share Plane**: a
permission-gated, fully-audited grant system where one utility reads another's
data (`kb.scoped*`) or calls a verb it exports (`capabilities.invoke`), only
with your **just-in-time consent** — never blanket access. Two utilities ship by
default:

- **`learn-anything`** — chat-driven topic learning, materialised into the KB.
- **`task-board`** — Kanban board with agent-dispatch, git worktrees, pre/post
  hooks, and auto-pickup.

See [docs/utilities.md](docs/utilities.md) and [docs/sharing.md](docs/sharing.md).

### 🌳 Worktree-isolated agent dispatch

Code tasks dispatched from the task-board each get an isolated git worktree on
`task/<slug>`, so parallel agents work the same repo without colliding. PR mode
auto-detects the `gh` CLI and turns "Merge" into "Open PR".
See [docs/tasks.md](docs/tasks.md).

### 🔐 Permissions + audit trail

Every utility runs sandboxed and declares an explicit permission allowlist;
every host-API call is recorded in an append-only audit log you can inspect.
Sensitive powers (spawning agents, mutating git) require dedicated, consented
permission slots. See [docs/host-api.md](docs/host-api.md).

## Architecture at a glance

One Node process. Inside it:

- Next.js App Router HTTP server (UI + server actions).
- A background workflow scheduler (in-process singleton).
- A worker pool for utility server actions.
- Subprocess agents (Claude Code / Codex) spawned per topic.
- MCP servers on demand.

Two filesystem homes: `REFLEX_HOME` (global state) and `<root>/.reflex/`
(per-Space). For the full layer diagram see
[docs/architecture.md](docs/architecture.md).

## Documentation

| Doc | Topic |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System map, process model, two-homes layout |
| [docs/memory.md](docs/memory.md) | 8-file taxonomy, caps, hygiene, weekly rollup |
| [docs/sessions.md](docs/sessions.md) | FTS5 recall over journal + topics |
| [docs/topics.md](docs/topics.md) | Chat transcripts, event log, `/goal` mode |
| [docs/kb.md](docs/kb.md) | Knowledge-base entries, kinds, slug rules |
| [docs/workflows.md](docs/workflows.md) | Step kinds, templates, scheduler, system tasks |
| [docs/utilities.md](docs/utilities.md) | Extension model, manifest, permissions, iframe + worker |
| [docs/sharing.md](docs/sharing.md) | Cross-utility data sharing (the Share Plane) |
| [docs/host-api.md](docs/host-api.md) | Full `reflex.*` method reference |
| [docs/markers.md](docs/markers.md) | `<<reflex:*>>` protocol reference |
| [docs/skills.md](docs/skills.md) | Skill files, scopes, marker authoring |
| [docs/tasks.md](docs/tasks.md) | task-board utility, worktree mechanics, PR mode |
| [docs/agents.md](docs/agents.md) | Claude Code / Codex App Server integration, permissioning |

## CLI

```sh
reflex start                  # launch the web UI
reflex init <dir>             # scaffold .reflex/ and run initial agent pass
reflex watch <dir>            # watch dir and refresh KB on changes
reflex chat <dir>             # open a chat scoped to dir's KB
```

## Data directory

Reflex stores its global state (registered roots, settings, MCP config, secrets,
skills, sessions index, …) in one directory:

- **Dev (`pnpm dev`)** → `~/.reflex`
- **Prod (`reflex start` via npm-installed CLI)** → `~/.reflex-agent`

Override either by setting `REFLEX_HOME=/your/path` before launching.

## Develop from source

```sh
pnpm install
pnpm dev        # http://localhost:3211 (Next dev server with HMR)
pnpm build      # produce dist/ + .next/ for `reflex start`
pnpm typecheck
pnpm test       # vitest
```

PRs welcome. The codebase favours small, focused modules — when in doubt, look
at neighbouring files and match the style.

## Config (`.reflex/config.json`)

```json
{
  "watchDebounceMs": 1800000,
  "agentBackend": "codex",
  "ignoreFile": ".reflexignore"
}
```

`watchDebounceMs` defaults to 30 minutes (`1800000`). Lower it for tighter
loops; the enforced minimum is 1 second (anti-thrash).

## License

[MIT](LICENSE) © the Reflex authors.
