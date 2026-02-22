# Commands

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

Examples:
```text
/help
/new
/exit
```

### Web commands

Hive supports web browsing and search via Playwright-backed helpers.

- `/browse <url>`: fetch a page and inject it into the prompt as *untrusted context*
- `browse <url>`: same as `/browse`
- `/search <query>`: search the web and inject results into the prompt as *untrusted context*
- `search <query>`: same as `/search`

Examples:
```text
/browse https://example.com
/browse example.com What are the key claims on this page?

/search best budget mechanical keyboard
search postgres jsonb indexing tips
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
- `/hive init`: prints instructions to run `hive init` from your shell (interactive)
- `/hive nuke`: prints instructions to run `hive nuke` from your shell (interactive)

Examples:
```text
/hive status
/hive config show
/hive config provider
```

### Reserved / referenced in `CHANGELOG.md` (not implemented in this repo yet)

The following slash commands are referenced in the `v0.1.2` changelog entry, but are not present in the current source tree. In chat today, they will be rejected as unknown commands:
- `/remember`
- `/forget`
- `/tldr`
- `/mode`
- `/export`
- `/history`
- `/think`
- `/clear`

Example (current behavior):
```text
/remember this
Unknown command: /remember this
```

