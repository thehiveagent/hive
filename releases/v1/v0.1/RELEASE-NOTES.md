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

### What's next

v0.2 — the agent works while you sleep. Background daemon, task queue, scheduled jobs, web browsing.