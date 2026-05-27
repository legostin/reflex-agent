# Reflex

Local-first knowledge base. You point Reflex at a directory; an agent (Codex via agent-use or Claude Code in agent mode) walks it and materializes a hierarchical `.reflex/` of Markdown files describing what's there. Background watchers keep it fresh, with a debounce floor (≥ 30 min, configurable) so the agent never runs too often. Per-folder chats let you query the KB the same way you'd query ChatGPT/Codex, but scoped to that subdirectory.

## Web UI

```sh
pnpm install
pnpm dev     # http://localhost:3210
```

Home page lists registered "Reflex roots". Add a directory via the built-in
file picker, then click **Run init** on the detail page to have the agent
build the KB. The left sidebar shows the resulting MD tree under `.reflex/`;
clicking a file renders it.

## Layout produced

```
<your-dir>/
├── .reflexignore            # gitignore-syntax — same rules
└── .reflex/
    ├── config.json          # debounce, agent backend, etc.
    ├── INDEX.md             # description of the whole dir
    └── <subdir>/
        ├── INDEX.md         # description of this subdir
        └── *.md             # topic-structured notes
```

## CLI

The CLI is built separately from the web UI:

```sh
pnpm build:cli
node dist/bin/cli.js init <dir>
node dist/bin/cli.js watch <dir>
node dist/bin/cli.js chat <dir>
```

## Config (`.reflex/config.json`)

```json
{
  "watchDebounceMs": 1800000,
  "agentBackend": "codex",
  "ignoreFile": ".reflexignore"
}
```

`watchDebounceMs` defaults to 30 minutes (`1800000`). You can lower it in `.reflex/config.json` if you want a tighter loop; the only enforced minimum is 1 second (anti-thrash).
