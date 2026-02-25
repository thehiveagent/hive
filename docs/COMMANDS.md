# Commands (v0.1.8)

This document describes the CLI commands and in-chat slash commands implemented in this repository.

## CLI

### `hive`

Starts the interactive chat UI (same as `hive chat`, but `hive` is preferred). If you pass no arguments, Hive drops you into chat.

Examples:
```bash
hive
```

### `hive init`

Interactive first-run setup. Creates/updates your local Hive profile and copies `prompts/` into `~/.hive/prompts/`.

Options:
- `--force`: overwrite `~/.hive/prompts/` when loading prompts

Examples:
```bash
hive init
hive init --force
```

### `hive chat` (deprecated)

Interactive chat UI. Use `hive` instead.

Options:
- `-m, --message <text>`: send a single message and exit
- `-c, --conversation <id>`: continue an existing conversation
- `--model <model>`: override model for this session
- `--title <title>`: title for a newly created conversation
- `-t, --temperature <value>`: sampling temperature (number)
- `--preview`: run the chat UI preview without Hive initialization

Examples:
```bash
hive chat
hive chat --message "Summarize my last conversation"
hive chat --conversation 123 --message "Continue from here"
hive chat --model gpt-4o-mini --temperature 0.2
hive chat --preview
```

### `hive daemon`

Manage the background agent process. The daemon automatically restarts, communicates over TCP IPC on port `2718`, and uses a sentinel stop protocol so it only stops when explicitly told.

Subcommands:
- `hive daemon start`: start the daemon in the background
- `hive daemon stop`: cleanly stop the daemon using the sentinel stop protocol
- `hive daemon restart`: gracefully restart the daemon
- `hive daemon status`: print current daemon status and health
- `hive daemon logs`: tail the daemon logs

Examples:
```bash
hive daemon start
hive daemon status
hive daemon stop
```

### `hive config`

Update provider/model/API keys/theme without re-running init.

Subcommands:
- `hive config provider`: interactive provider + model + key setup
- `hive config model`: interactive model selection for the current provider
- `hive config key`: interactive API key update for the current provider
- `hive config show`: print provider/model/key status
- `hive config theme`: interactive accent theme picker (amber/cyan/rose/slate/green/custom hex)

Examples:
```bash
hive config
hive config show
hive config provider
hive config model
hive config key
hive config theme
```

### `hive status`

Shows your local Hive status: owner, agent name, provider/model, API key set/not set, database path + size, prompts file count, and initialization date.

Example:
```bash
hive status
```

### `hive doctor`

Runs a diagnostic pass over your local Hive setup (database, prompts, theme config, provider reachability, Playwright install, Node version, and basic DB counts).

Example:
```bash
hive doctor
```

### `hive memory`

Manage stored knowledge and episodic memory without leaving the CLI.

Subcommands:
- `hive memory list`: show all knowledge graph entries (pinned marked)
- `hive memory auto`: show automatically extracted facts (source `auto`) with timestamps
- `hive memory clear`: delete all episodic memories (prompts for confirmation)
- `hive memory show`: print the current persona

Examples:
```bash
hive memory list
hive memory auto
hive memory clear
hive memory show
```

### `hive update`

Updates the globally installed Hive CLI to the latest published version (npm), then syncs missing prompts and warms the context cache when possible.

Example:
```bash
hive update
```

### `hive nuke`

Irreversibly deletes your local Hive data (`~/.hive/`) and attempts to delete API keys stored in your OS keychain under the `hive` service.

Example:
```bash
hive nuke
```

## In-chat commands (slash commands)

These commands are available inside the interactive chat UI (`hive`).

### Chat commands

- `/` or `/help`: show chat commands
- `/new`: start a new conversation context (resets the active conversation id)
- `/exit` or `/quit`: quit chat
- `/clear`: clear the terminal while staying in the same conversation
- `/status`: print mode, provider, model, and conversation id inline
- `/daemon`: print current daemon status in chat

Examples:
```text
/help
/new
/exit
/status
/daemon
/clear
```

### Web commands

Hive supports web browsing and search via Playwright-backed helpers.

- `/browse <url>`: fetch a page and inject it into the prompt as *untrusted context*
- `browse <url>`: same as `/browse`
- `/search <query>`: search the web and inject results into the prompt as *untrusted context*
- `search <query>`: same as `/search`
- `/summarize <url>`: open a page and stream a concise summary back

Examples:
```text
/browse https://example.com
/browse example.com What are the key claims on this page?

/search best budget mechanical keyboard
search postgres jsonb indexing tips
/summarize https://example.com
```

### Hive shortcuts (`/hive ...`)

Shortcuts let you run a subset of CLI commands without leaving chat.

Supported shortcuts:
- `/hive help`: list shortcuts
- `/hive status`: run `hive status`
- `/hive config show`: run `hive config show`
- `/hive config provider`: interactive provider setup (in-chat)
- `/hive config model`: interactive model setup (in-chat)
- `/hive config key`: interactive key setup (in-chat)
- `/hive config theme`: interactive theme setup (in-chat)
- `/hive memory list`: list knowledge entries
- `/hive memory clear`: clear episodic memory (prompts)
- `/hive memory show`: show current persona
- `/hive init`: prints instructions to run `hive init` from your shell (interactive)
- `/hive nuke`: prints instructions to run `hive nuke` from your shell (interactive)

Examples:
```text
/hive status
/hive config show
/hive config provider
/hive memory list
```

### Memory and summaries

- `/remember <fact>`: save a fact to the knowledge graph
- `/pin <fact>`: save a pinned fact that always enters context
- `/forget <thing>`: delete the closest matching fact (with confirmation)
- `/tldr`: summarize the current conversation (3–5 bullets)
- `/recap`: summarize everything known about you (persona + knowledge)
- `/mode <default|research|code|brainstorm|brief>`: switch response style
- `/save <title>`: set the current conversation title
- `/history`: list recent conversations and resume one
- `/export`: export the current conversation to `~/.hive/exports/<id>.md`
- `/retry`: resend the last user message
- `/copy`: copy last assistant reply to clipboard (pbcopy/xclip fallback)
- `/think <question>`: request chain-of-thought reasoning inline

Example:
```text
/remember Loves Ethiopian pour-over
/pin Lives in Seattle
/tldr
/recap
/mode brief
/retry
```

## Test Scripts

The Hive includes a comprehensive test suite located in the `scripts/` directory to validate functionality.

To run all tests sequentially:
```bash
npm run test
# OR
npx ts-node scripts/test-all.ts
```

Individual component tests can also be run separately:
- `npx ts-node scripts/test-db.ts` — Tests SQLite storage and memory logic
- `npx ts-node scripts/test-providers.ts` — Tests LLM provider reachability
- `npx ts-node scripts/test-hive-ctx.ts` — Tests context engine integration
- `npx ts-node scripts/test-daemon.ts` — Tests daemon lifecycle and IPC
- `npx ts-node scripts/test-cli.ts` — Tests CLI command parsing and help output
- `npx ts-node scripts/test-browser.ts` — Tests Playwright browser connectivity
- `npx ts-node scripts/test-memory.ts` — Tests episodic memory and recall
- `npx ts-node scripts/test-theme.ts` — Tests CLI UI theme configurator
- `npx ts-node scripts/test-prompts.ts` — Tests prompt generation and defaults
