import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Provider } from "../providers/base.js";
import type { HiveCtxSession } from "./hive-ctx.js";
import {
  getHiveHomeDir,
  getMetaValue,
  insertEpisode,
  insertKnowledge,
  listEpisodes,
  listKnowledge,
  setMetaValue,
  type HiveDatabase,
} from "../storage/db.js";

type JsonArray = string[] | unknown;

const AUTO_SOURCE = "auto";
const CRYSTALLIZED_SOURCE = "auto_crystallized";
const EXTRACTION_SYSTEM_PROMPT =
  "Extract any personal facts, preferences, goals, or notable information about the user from this conversation. Return as JSON array of strings. If nothing notable, return empty array. Be selective — only extract durable facts, not temporary context.";
const EMOTION_SYSTEM_PROMPT =
  "Identify any emotional state or mood the user expresses in this exchange. Return a single short phrase (e.g., \"anxious about work\") or an empty string if none.";
const CRYSTALLIZE_SYSTEM_PROMPT =
  "Based on these conversations, what are the most important things to know about this person long term? What are their patterns, goals, values, and preferences? Return as JSON array.";
const MAX_HISTORY_FOR_DUP_CHECK = 500;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PassiveMemoryInput {
  db: HiveDatabase;
  provider: Provider;
  model: string;
  userMessage: string;
  assistantMessage: string;
  hiveCtx: HiveCtxSession | null;
}

export function schedulePassiveMemory(input: PassiveMemoryInput): void {
  // Fire-and-forget; never block the main chat loop.
  setImmediate(() => {
    void runPassiveMemory(input).catch((error) => logBackgroundError(error));
  });
}

async function runPassiveMemory(input: PassiveMemoryInput): Promise<void> {
  const exchange = `User: ${input.userMessage}\nAssistant: ${input.assistantMessage}`;

  try {
    const summary = exchange.length > 2000 ? `${exchange.slice(0, 2000)}…` : exchange;
    insertEpisode(input.db, summary);
  } catch (error) {
    logBackgroundError(error);
  }

  await extractAndStoreFacts({
    db: input.db,
    provider: input.provider,
    model: input.model,
    exchange,
  });

  await extractAndStoreEmotion({
    provider: input.provider,
    model: input.model,
    exchange,
    hiveCtx: input.hiveCtx,
  });

  const previousLastConversation = getMetaValue(input.db, "last_conversation_at");
  const nowIso = new Date().toISOString();
  bumpConversationCount(input.db);
  setMetaValue(input.db, "last_conversation_at", nowIso);

  const count = Number.parseInt(getMetaValue(input.db, "conversation_count") ?? "0", 10);
  const lastInteractionStale =
    previousLastConversation &&
    Date.now() - Date.parse(previousLastConversation) > RECENCY_WINDOW_MS;

  if (count % 10 === 0 && !lastInteractionStale) {
    await crystallizeEveryTen(input);
  }
}

async function extractAndStoreFacts(input: {
  db: HiveDatabase;
  provider: Provider;
  model: string;
  exchange: string;
}): Promise<void> {
  const facts = await completeJsonArray(input.provider, input.model, EXTRACTION_SYSTEM_PROMPT, input.exchange);
  if (!Array.isArray(facts) || facts.length === 0) {
    return;
  }

  for (const raw of facts) {
    if (typeof raw !== "string") continue;
    const fact = raw.trim();
    if (!fact || hasSimilarKnowledge(input.db, fact)) continue;
    insertKnowledge(input.db, { content: fact, pinned: false, source: AUTO_SOURCE });
  }
}

async function extractAndStoreEmotion(input: {
  provider: Provider;
  model: string;
  exchange: string;
  hiveCtx: HiveCtxSession | null;
}): Promise<void> {
  if (!input.hiveCtx) return;
  const result = await completeSingleString(input.provider, input.model, EMOTION_SYSTEM_PROMPT, input.exchange);
  const mood = result.trim();
  if (!mood) return;
  await Promise.resolve(input.hiveCtx.remember(mood)).catch(() => {});
}

async function crystallizeEveryTen(input: PassiveMemoryInput): Promise<void> {
  const episodes = listEpisodes(input.db, 20).slice(0, 10);
  if (episodes.length === 0) return;

  const summaries = episodes.map((episode) => episode.content).join("\n---\n");
  const crystals = await completeJsonArray(
    input.provider,
    input.model,
    CRYSTALLIZE_SYSTEM_PROMPT,
    summaries,
  );

  if (!Array.isArray(crystals) || crystals.length === 0) {
    return;
  }

  for (const raw of crystals) {
    if (typeof raw !== "string") continue;
    const fact = raw.trim();
    if (!fact || hasSimilarKnowledge(input.db, fact)) continue;
    insertKnowledge(input.db, { content: fact, pinned: true, source: CRYSTALLIZED_SOURCE });
    if (input.hiveCtx) {
      await Promise.resolve(input.hiveCtx.remember(fact, { pinned: true })).catch(() => {});
    }
  }
}

function hasSimilarKnowledge(db: HiveDatabase, fact: string): boolean {
  const terms = tokenize(fact);
  if (terms.size === 0) return false;

  const rows = listKnowledge(db, { limit: MAX_HISTORY_FOR_DUP_CHECK });
  for (const row of rows) {
    const overlap = countOverlap(terms, tokenize(row.content));
    if (overlap >= Math.min(2, terms.size)) {
      return true;
    }
  }
  return false;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4),
  );
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const term of a) {
    if (b.has(term)) count += 1;
  }
  return count;
}

async function completeJsonArray(
  provider: Provider,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<JsonArray> {
  if (typeof provider.completeChat !== "function") {
    return [];
  }

  try {
    const response = await provider.completeChat({
      model,
      maxTokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return parseJsonArray(response.content);
  } catch (error) {
    logBackgroundError(error);
    return [];
  }
}

async function completeSingleString(
  provider: Provider,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  if (typeof provider.completeChat !== "function") {
    return "";
  }

  try {
    const response = await provider.completeChat({
      model,
      maxTokens: 50,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return typeof response.content === "string" ? response.content : "";
  } catch (error) {
    logBackgroundError(error);
    return "";
  }
}

function parseJsonArray(value: unknown): JsonArray {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function bumpConversationCount(db: HiveDatabase): void {
  const raw = getMetaValue(db, "conversation_count");
  const current = Number.parseInt(raw ?? "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  setMetaValue(db, "conversation_count", String(next));
}

function logBackgroundError(error: unknown): void {
  try {
    const hiveHome = getHiveHomeDir();
    mkdirSync(hiveHome, { recursive: true });
    const logPath = join(hiveHome, "daemon.log");
    const timestamp = new Date().toISOString();
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    appendFileSync(logPath, `[${timestamp}] passive-memory error: ${message}\n`);
  } catch {
    // Swallow logging failures silently.
  }
}
