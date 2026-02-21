• v0.1.1 command surface:

  CLI commands

  - hive → opens interactive chat (default entrypoint)
  - hive init [--force] → initialize agent + local Hive state
  - hive chat [options] → deprecated alias for hive
  - hive config → config command group
  - hive config provider → interactive provider/model/key update
  - hive config model → interactive model update
  - hive config key → interactive API key update
  - hive config show → show provider/model/agent/key status
  - hive status → full local status report
  - hive nuke → permanently delete local Hive data + keys
  - hive help [command]
  - Global options: -V, --version, -h, --help

  hive chat options

  - -m, --message <text>
  - -c, --conversation <id>
  - --model <model>
  - --title <title>
  - -t, --temperature <value>
  - --preview

  In-chat commands

  - /help (and bare / resolves to help)
  - /new
  - /exit
  - /quit
  - /browse <url>
  - browse <url>
  - /search <query>
  - search <query>
  - /hive help
  - /hive status
  - /hive config show
  - /hive config provider (interactive in chat)
  - /hive config model (interactive in chat)
  - /hive config key (interactive in chat)
  - /hive init and /hive nuke are shell-only safety commands

  Current features

  - Centered “HIVE / Command Centre” UI across command pages
  - Chat-first CLI (hive opens chat)
  - Deprecated hive chat messaging
  - Live / autocomplete with scrollable suggestion viewport
  - Arrow/Tab/Enter suggestion navigation + selection
  - Slash-command hardening (unknown slash commands handled locally, not sent to model)
  - Browser-augmented chat flow for search/browse prompts
  - In-chat provider/model switching without dropping back to shell
  - Local-first storage (~/.hive), prompt loading from .hive/prompts, keychain-backed keys