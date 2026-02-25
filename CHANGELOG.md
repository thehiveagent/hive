# Changelog

## v0.1.8 — Passive Memory

- Passive memory extraction after each assistant reply (no `/remember` required)
- Auto-stored durable facts with `source=auto` + de-duplication by keyword overlap
- Mood/emotion signals stored into hive-ctx graph with temporal decay
- Crystallization every 10 conversations into pinned long-term facts (skips if inactive >7 days)
- `hive memory auto` + `/hive memory auto` to list auto-extracted facts with timestamps
- `hive update` command to update the global CLI and warm prompt/context caches

## v0.1.7 — The Agent Lives

- Background daemon with auto-restart via watcher process
- Cross-platform service registration: launchd (macOS), systemd (Linux), Task Scheduler (Windows)
- Sentinel stop protocol — daemon only stops when explicitly told, never on crash
- TCP IPC on port 2718 — The Hive's dedicated local port
- `hive daemon start/stop/restart/status/logs` commands
- `/daemon` in-chat slash command
- Comprehensive test suite in `scripts/` — `test-all`, `test-db`, `test-providers`, `test-hive-ctx`, `test-daemon`, `test-cli`, `test-browser`, `test-memory`, `test-theme`, `test-prompts`
- Daemon health checks in `hive doctor` and `hive status`
- `hive nuke` cleanly stops daemon before wipe
- `hive init` asks to start daemon on boot

## v0.1.6 — The Context Engine

- `hive-ctx` integrated as context pipeline
- 538 input tokens → 9 tokens on warm messages
- Knowledge graph, 3-tier memory, fingerprint compiler, weighted retrieval all active
- `hive-ctx` published as standalone npm package for anyone building agentic systems
- `~/.hive/ctx/` as dedicated context storage
- Fallback to legacy pipeline if `hive-ctx` unavailable

## v0.1.5 — Stronger Foundation

- Rebuilt base persona — The Hive voice
- Layered context pipeline: identity, pinned facts, episodic memory, mode, prompts, time
- Resilient streaming: 30s timeout, auto-retry on 429/503, partial response capture
- Thinking spinner while waiting for first token
- Provider reachability check on chat start
- API key verification on init before saving
- Review + confirm screen in init
- HIVE-ID minting animation
