# CLAUDE.md — Hive Project Context

## Project Overview

**Hive** — A local-first p2p AI agent CLI written in TypeScript/Node.js.

- **npm package**: `@misbahk/hive`
- **Organization**: `thehiveagent`
- **Repository**: github.com/thehiveagent/hive

## Tech Stack

- **Node**: 20 LTS strictly
- **TypeScript**: ESM (ES Modules)
- **Database**: better-sqlite3
- **Secrets**: keytar
- **UI**: chalk, commander, inquirer
- **Browser Automation**: playwright
- **Context Engine**: hive-ctx (submodule)

## Repository Structure

```
src/
├── cli/
│   ├── commands/    # Individual command implementations
│   ├── index.ts    # Command registration
│   └── ui.ts       # Centralized UI utilities
├── agent/          # Core AI agent logic
├── providers/      # LLM provider integrations
├── storage/       # SQLite database helpers
├── browser/        # Playwright automation
└── daemon/         # Local TCP daemon

prompts/            # AI prompt templates
hive-ctx/          # Context engine submodule (at root)
docs/              # Documentation
releases/          # Release artifacts
```

## Build and Run

```bash
npm install           # Install dependencies
npm run build         # Compile TypeScript
npm run typecheck     # Type check only
npm run lint          # Lint code
node dist/cli/index.js <command>  # Test locally

# NEVER use `hive` directly during development
```

## Key Conventions

- **User data location**: `~/.hive/` — never write elsewhere
- **API keys**: Store via keytar only — never plaintext
- **UI output**: Use `src/cli/ui.ts` — never raw chalk calls in command files
- **Local communication**: Port `2718` for all TCP/daemon traffic
- **Provider interface**: All providers must implement `Provider` from `src/providers/base.ts`
- **New commands**: Add to `src/cli/commands/`, register in `src/cli/index.ts`
- **Database access**: Use helper functions in `src/storage/db.ts` — never raw SQL in command files

## hive-ctx Submodule

- **Location**: `hive-ctx/` (at repo root)
- **Imported in**: `src/agent/hive-ctx.ts`
- **Published separately**: as `hive-ctx` on npm
- **Context pipeline changes**: Edit `src/agent/hive-ctx.ts` first

## Testing

No test suite yet. Test by running:
```bash
node dist/cli/index.js <command>
```

## Shipping

```bash
npm version X.X.X
git push origin master --tags
```

This triggers GitHub Actions to publish to npm automatically.
