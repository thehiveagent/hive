# ADR 001 — Local-First SQLite Storage

**Status:** Accepted  
**Date:** 2025

---

## Decision

All agent data — persona, episodic memory, knowledge graph, task history, audit logs — is stored locally in SQLite. Nothing is sent to a remote database. Nothing requires a cloud account.

---

## Why

The Hive's core promise is that your agent is yours. Completely. That promise breaks the moment user data touches an external server we control.

SQLite is:
- Fast enough for everything we need
- Zero dependency — ships as a single file
- Battle-tested at massive scale
- Already used by Genie (consistency)
- Trivially encryptable at rest

---

## What We Rejected

**Postgres/MySQL** — requires a running server, adds ops complexity, external dependency. Rejected.

**Cloud databases (Supabase, Firebase, etc.)** — violates local-first principle entirely. Rejected.

**File-based JSON storage** — no query capability, no transactions, breaks under concurrent access. Rejected.

---

## Consequences

- User data never leaves the machine by default
- Air gap mode works trivially — nothing to disconnect
- Backup is just copying a file
- We need to handle SQLite migrations carefully as schema evolves
- Multi-device sync is a future problem we defer intentionally