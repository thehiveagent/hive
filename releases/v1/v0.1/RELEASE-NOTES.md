## 🐝 v0.1.0 — The Agent Is Born

The first release of The Hive. One agent. One machine. Talking.

### What's in v0.1

- `hive init` — full birth flow. Name, DOB, location, profession, about, provider, model, API key. Runs once. Your agent is yours.
- `hive chat` — streaming conversations with full memory context. Feels like talking to something that knows you.
- `hive config` — change provider, model, or API key on the fly. No reinit needed.
- `hive status` — see your agent, provider, model, DB size, prompts loaded.
- `hive nuke` — full wipe. Agent, memory, keys. Gone.
- Multi-provider — OpenAI, Anthropic, Google, Ollama, Groq, Mistral, OpenRouter, Together
- Local-first — everything stored in `~/.hive/`. Nothing in the cloud.
- API keys in OS keychain — never written to disk in plaintext.
- Prompts folder — drop `.md` files into `~/.hive/prompts/` to shape your agent's behavior permanently.

### Install

````bash
npm install -g @imisbahk/hive
hive init
````

## 🐝 v0.1.1 — Chat-First CLI + Command Centre Upgrades

### What's in v0.1.1

- `hive` now opens interactive chat by default.
- `hive chat` is now deprecated (still supported as an alias).
- In-chat command suggestions: type `/` to see matching commands while typing.
- In-chat Hive shortcuts:
  - `/hive status`
  - `/hive config show`
  - `/hive config provider`
  - `/hive config model`
  - `/hive config key`
- Embedded config flows in chat now keep session continuity and recover terminal input state.
- Chat input hardening:
  - bare `/` resolves locally instead of falling through to model messages
  - unknown slash commands are handled locally with clear errors

### Upgrade

```bash
npm install -g @imisbahk/hive@0.1.1
```

## 🐝 v0.1.2 — Themes + Live Accent Preview

### What's in v0.1.2

- New `hive config theme` command to set the CLI accent theme.
- Built-in theme options:
  - `amber` (`#FFA500`) default beehive accent
  - `cyan` (`#00BCD4`)
  - `rose` (`#FF4081`)
  - `slate` (`#90A4AE`)
  - `green` (`#00E676`)
  - `custom` (user-provided hex)
- Live theme preview: moving through the picker updates the UI accent in real time before selection.
- Theme persistence in local DB metadata (`~/.hive/hive.db`):
  - `theme`
  - `theme_hex`
- Accent color is now consistent across the command centre UI:
  - ASCII HIVE wordmark
  - separators
  - prompt symbol (`›`)
  - agent name prefix in chat
  - success indicator (`✓`)
  - step indicator (`›`)
- New in-chat shortcut: `/hive config theme`

### Upgrade

```bash
npm install -g @imisbahk/hive@0.1.2
```

## 🐝 v0.2.0 — Doctor (Health Checks)

### What's in v0.2.0

- New `hive doctor` command runs a full diagnostic pass across local Hive setup.
- Live, sequential output (no spinner) so checks feel immediate as they complete.
- Checks include:
  - Agent initialized (DB record exists)
  - Database readable + integrity check + size warning when large
  - API key present in OS keychain
  - Provider reachability (5s timeout)
  - Prompts folder present with files
  - Theme selection from local DB metadata
  - Node version warning if < v20
  - Playwright + Chromium installed
  - Ollama running when provider is `ollama`
  - Basic DB stats (messages, conversations, episodes when table exists)

### Upgrade

```bash
npm install -g @imisbahk/hive@0.2.0
```
