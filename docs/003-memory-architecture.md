# ADR 003 — 3-Layer Memory Architecture

**Status:** Accepted  
**Date:** 2025

---

## Decision

Agent memory is split into three distinct layers, each with a different lifecycle and purpose:

1. **Core Persona** — compressed personality snapshot
2. **Episodic Memory** — recent events as semantic embeddings
3. **Knowledge Graph** — permanent hard facts

---

## Why

A naive approach — appending every conversation to a growing context — fails in two ways: it hits token limits fast, and it treats a 3-year-old interaction the same as a conversation from this morning.

Human memory doesn't work that way. Some things are permanent (your name, your profession). Some things are recent and contextually relevant (what you worked on this week). Some things define who you are at a level that doesn't need raw recall — just influences behavior.

---

## Layer Details

### Core Persona
- Rebuilt nightly by a compression process
- Takes all interactions from the day, extracts what matters, rewrites the persona
- Never grows — stays at a fixed token budget
- Influences the system prompt on every conversation

### Episodic Memory
- Recent interactions stored as vector embeddings (sqlite-vec)
- Semantically searchable — retrieved by relevance, not recency alone
- Rolling window — old episodes decay and are absorbed into persona
- Answers "what happened recently that's relevant to this conversation"

### Knowledge Graph
- Permanent hard facts — name, DOB, profession, relationships, preferences
- Written explicitly (by user or extracted with high confidence)
- Never expires, never decays
- Tiny footprint — just structured facts

---

## Context Window Assembly

On every agent invocation, context is assembled dynamically:

```
system prompt
  + core persona (always)
  + relevant knowledge graph facts (filtered by relevance)
  + relevant episodic memories (top-k by embedding similarity)
  + conversation history (recent turns)
  + current task context
```

Total context stays within budget. Always. No bloat.

---

## What We Rejected

**Single growing context file** — hits token limits, no prioritization, expensive. Rejected.

**External vector database** — adds dependency, breaks local-first. Rejected (sqlite-vec instead).

**No memory** — stateless agent is just a chatbot. Not what we're building. Rejected.