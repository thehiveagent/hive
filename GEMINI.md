# GEMINI.md — Hive Project Context

## What we're building
**The Hive** — a local-first, p2p AI agent platform. Every user owns a node. Every node is an agent. Agents communicate across a mesh network, work autonomously, grow smarter over time.

Not a chatbot. Not a cloud product. A personal AI that lives on your machine.

- **npm:** `@imisbahk/hive`
- **org:** `github.com/thehiveagent`
- **current version:** v0.1.6

## Tech stack
- TypeScript/Node.js — CLI and agent core
- Rust — planned for daemon (v0.7) and mesh (v0.8)
- SQLite (better-sqlite3) — local storage at `~/.hive/hive.db`
- **hive-ctx** — custom context engine, published as `@imisbahk/hive-ctx` on npm. Rust core + TS bindings. Knowledge graph, 3-tier memory, fingerprint compiler, weighted retrieval. Drops context from 538 → 9 tokens on warm messages.
- Playwright — browser access
- keytar — OS keychain for API keys
- Providers: OpenAI, Anthropic, Google, Ollama, Groq, Mistral, OpenRouter, Together

## Repo structure
```
hive/                        ← @imisbahk/hive
  src/
    cli/commands/            ← init, chat, config, status, doctor, nuke, memory
    agent/                   ← agent.ts, prompts.ts, hive-ctx.ts
    providers/               ← one file per provider + base + resilience
    storage/                 ← db.ts (SQLite)
    browser/                 ← browser.ts (Playwright)
  prompts/                   ← copied to ~/.hive/prompts/ on init
  .github/workflows/         ← publish.yml (on v* tags), ci.yml (on PRs)

hive-ctx/                    ← standalone package, published as `@imisbahk/hive-ctx`
  crates/hive-ctx-core/src/
    graph.rs, memory.rs, fingerprint.rs,
    classifier.rs, retrieval.rs, pipeline.rs
  packages/bindings/         ← TS overlay, plugin system
...
```

## CLI commands
```
hive                  ← default entrypoint, opens chat
hive init [--force]
hive config provider / model / key / show / theme
hive status
hive doctor
hive nuke
hive memory list / clear / show
hive --version
...
```

## In-chat slash commands
```
/search <query>    /browse <url>    /summarize <url>
/remember <fact>   /forget <thing>  /pin <fact>
/tldr              /recap           /think <question>
/mode <name>       /export          /history
/save <title>      /status          /retry
/copy              /clear           /new
/exit
...
```

## Storage layout
```
~/.hive/
  hive.db           ← agent profile, conversations, messages, knowledge, episodes
  prompts/          ← system.md, memory.md, behavior.md, code.md
  exports/          ← /export dumps
  ctx/              ← hive-ctx databases
    hive_graph.sqlite
    hive_memory.sqlite
```

## Roadmap (brief)
```
v0.1.6    ✅ current — hive-ctx integrated, 9 token warm context
v0.1.6.1  ⬜ fix @imisbahk/hive-ctx import
v0.1.7    ⬜ TBD
v0.2      ⬜ daemon, task queue, scheduling, terminal + file access
v0.3      ⬜ code mode, Genie MCP
v0.4      ⬜ Gmail, Calendar, Slack, WhatsApp, Telegram, GitHub
v0.5      ⬜ local web dashboard
v0.6      ⬜ sub-agent spawning
v0.7      ⬜ OS capabilities, WireGuard, Docker (Rust daemon)
v0.8      ⬜ rust-libp2p mesh, Kademlia DHT, HIVE-ID
v0.9      ⬜ economy layer, bounties, marketplace
v1.0      ⬜ voice, legacy, Hive Mind, public launch
```

## How we work
- Misbah uses **Codex** for implementation — give prompts, not code
- Prompts are context-heavy, no code samples — "Codex will figure it out"
- Commit messages are short and sharp
- Ships via git tag → GitHub Actions → npm publish
- Node 20 LTS (`.nvmrc`) — NOT Node 24 (breaks better-sqlite3)
- Branches for features, direct push to master for small things
- Org: `thehiveagent` on GitHub

