# Contributing to The Hive

First — thanks for being here early. This thing is going to be something.

---

## Project Structure

```
hive/
├── src/
│   ├── cli/                  # CLI entry point and command definitions
│   │   ├── index.ts          # main entry, commander setup
│   │   └── commands/         # one file per command
│   │       ├── init.ts       # hive init
│   │       ├── chat.ts       # hive chat
│   │       ├── code.ts       # hive code
│   │       ├── task.ts       # hive task
│   │       ├── memory.ts     # hive memory
│   │       ├── agents.ts     # hive agents
│   │       ├── status.ts     # hive status
│   │       ├── ui.ts         # hive ui
│   │       └── nuke.ts       # hive nuke
│   │
│   ├── agent/                # agent core
│   │   ├── agent.ts          # main agent class
│   │   ├── persona.ts        # persona compression and management
│   │   ├── memory/           # memory architecture
│   │   │   ├── core.ts       # core persona layer
│   │   │   ├── episodic.ts   # episodic memory + embeddings
│   │   │   └── knowledge.ts  # knowledge graph
│   │   └── loop.ts           # perceive → plan → act → verify → learn
│   │
│   ├── providers/            # AI provider integrations
│   │   ├── base.ts           # provider interface
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── ollama.ts
│   │   ├── groq.ts
│   │   └── mistral.ts
│   │
│   ├── storage/              # local storage layer
│   │   ├── db.ts             # SQLite setup and migrations
│   │   ├── keychain.ts       # OS keychain integration
│   │   └── schema.ts         # database schema definitions
│   │
│   ├── daemon/               # background daemon
│   │   ├── daemon.ts         # main daemon process
│   │   ├── scheduler.ts      # task scheduling
│   │   └── service.ts        # OS service registration
│   │
│   ├── integrations/         # third party integrations
│   │   ├── base.ts           # integration interface
│   │   ├── gmail.ts
│   │   ├── calendar.ts
│   │   ├── notion.ts
│   │   ├── slack.ts
│   │   └── ...
│   │
│   ├── mesh/                 # p2p network layer (v0.8)
│   │   ├── node.ts           # libp2p node
│   │   ├── identity.ts       # keypair + HIVE-ID
│   │   ├── dht.ts            # kademlia DHT
│   │   └── gossip.ts         # gossipsub messaging
│   │
│   ├── browser/              # playwright automation
│   │   └── browser.ts
│   │
│   └── utils/                # shared utilities
│       ├── logger.ts
│       ├── crypto.ts
│       └── constants.ts
│
├── scripts/                  # build and install scripts
│   ├── install.sh            # curl install script
│   └── build.mjs
│
├── .hive-schema/             # DB migration files
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

---

## Dev Setup

```bash
git clone https://github.com/imisbahk/hive
cd hive
npm install
npm run dev        # watch mode
npm run build      # production build
npm link           # use `hive` command globally
```

---

## Principles

**Every command is deliberate.** Nothing is exposed that shouldn't be. Nothing hidden that matters. If a command exists it does exactly one thing and does it precisely.

**The network is invisible.** Users never manage the mesh. They never post to it, never configure it, never see it unless they want to. It just works underneath.

**The agent grows.** Nothing resets. Nothing is thrown away unless the user explicitly asks. Every interaction makes it more accurate.

**Local first. Always.** Nothing leaves the machine without explicit user action. The AI provider is the only external call, and the user chose it.

**Fail loudly, recover silently.** Errors surface clearly. Recovery happens automatically where possible. Nothing should leave the user stuck.

---

## Versioning

We follow semantic versioning. Pre-v1 everything is considered unstable API.

- `v0.x` — core platform building blocks
- `v1.0` — stable, public, production

---

## Commit Style

```
feat: add episodic memory compression
fix: provider connection timeout handling
chore: update dependencies
docs: expand mesh architecture section
refactor: split agent core into separate modules
```

---

## Questions

Open an issue. Or just ship it and we'll figure it out together.