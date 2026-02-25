import type { Provider } from "../providers/base.js";
import type { HiveCtxSession } from "../agent/hive-ctx.js";
import { schedulePassiveMemory } from "../agent/passive-memory.js";
import type { HiveAgent } from "../agent/agent.js";
import type { HiveDatabase, PlatformConversationMessage } from "../storage/db.js";
import { getPlatformConversation, upsertPlatformConversation } from "../storage/db.js";
import {
  isAuthorized,
  type IntegrationPlatform,
  upsertPendingAuth,
} from "./auth.js";
import { PerUserRateLimiter } from "./rate-limit.js";

export interface IncomingMessage {
  platform: IntegrationPlatform;
  from: string; // phone number, user ID, etc
  text: string;
  messageId: string;
  timestamp: number;
}

export interface OutgoingMessage {
  platform: string;
  to: string;
  text: string;
  replyTo?: string;
}

export interface MessageHandlerDeps {
  db: HiveDatabase;
  hiveAgent: HiveAgent | null;
  ctx: HiveCtxSession | null;
  provider: Provider | null;
  model: string | null;
  log: (line: string) => void;
}

const limiter = new PerUserRateLimiter(3000);

function parseMessages(raw: string | null): PlatformConversationMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => row as any)
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
        text: typeof row.text === "string" ? row.text : "",
        messageId: typeof row.messageId === "string" ? row.messageId : undefined,
        timestamp: typeof row.timestamp === "number" ? row.timestamp : Date.now(),
      }))
      .filter((row) => row.text.trim().length > 0);
  } catch {
    return [];
  }
}

function buildRecentHistorySystemPrompt(messages: PlatformConversationMessage[]): string | undefined {
  if (messages.length === 0) return undefined;
  const recent = messages.slice(-20);
  const lines = recent.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`);
  return `Conversation history (most recent last):\n${lines.join("\n")}`;
}

export function createMessageHandler(
  deps: MessageHandlerDeps,
): (msg: IncomingMessage) => Promise<OutgoingMessage> {
  return async (msg: IncomingMessage) => handleMessage(msg, deps);
}

export async function handleMessage(
  msg: IncomingMessage,
  deps: MessageHandlerDeps,
): Promise<OutgoingMessage> {
  const trimmed = msg.text.trim();
  const timestamp = Number.isFinite(msg.timestamp) ? msg.timestamp : Date.now();

  if (!isAuthorized(msg.platform, msg.from)) {
    upsertPendingAuth({
      platform: msg.platform,
      from: msg.from,
      timestamp,
      text: trimmed.slice(0, 200),
    });

    return {
      platform: msg.platform,
      to: msg.from,
      replyTo: msg.messageId,
      text: "Not authorized. Ask the Hive owner to approve you via `hive integrations auth add`.",
    };
  }

  if (!limiter.allow({ platform: msg.platform, from: msg.from }, timestamp)) {
    return {
      platform: msg.platform,
      to: msg.from,
      replyTo: msg.messageId,
      text: "Rate limited — try again in a moment.",
    };
  }

  if (!deps.hiveAgent) {
    return {
      platform: msg.platform,
      to: msg.from,
      replyTo: msg.messageId,
      text: "Hive daemon is running but the agent is not initialized. Run `hive init`.",
    };
  }

  const existing = getPlatformConversation(deps.db, msg.platform, msg.from);
  const history = parseMessages(existing?.messages ?? null);

  history.push({
    role: "user",
    text: trimmed,
    messageId: msg.messageId,
    timestamp,
  });

  const historySystemPrompt = buildRecentHistorySystemPrompt(history);
  const ctxBuilt = deps.ctx ? await deps.ctx.build(trimmed) : null;

  let assistantText = "";
  try {
    for await (const event of deps.hiveAgent.chat(trimmed, {
      title: `${msg.platform}:${msg.from}`,
      contextSystemPrompt: ctxBuilt?.system,
      systemAddition: historySystemPrompt,
      disableLegacyEpisodeStore: Boolean(deps.ctx),
    })) {
      if (event.type === "token") {
        assistantText += event.token;
      }
    }
  } catch (error) {
    deps.log(
      `[integrations] handler error (${msg.platform}:${msg.from}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      platform: msg.platform,
      to: msg.from,
      replyTo: msg.messageId,
      text: "Error generating response. Check ~/.hive/daemon.log.",
    };
  }

  history.push({
    role: "assistant",
    text: assistantText,
    timestamp: Date.now(),
  });

  try {
    upsertPlatformConversation(deps.db, {
      platform: msg.platform,
      externalId: msg.from,
      messages: history,
    });
  } catch (error) {
    deps.log(
      `[integrations] failed to store platform_conversation (${msg.platform}:${msg.from}): ${String(error)}`,
    );
  }

  if (deps.ctx) {
    void Promise.resolve(deps.ctx.episode(trimmed, assistantText)).catch(() => {});
  }

  if (deps.provider && deps.model) {
    schedulePassiveMemory({
      db: deps.db,
      provider: deps.provider,
      model: deps.model,
      userMessage: trimmed,
      assistantMessage: assistantText,
      hiveCtx: deps.ctx,
    });
  }

  return {
    platform: msg.platform,
    to: msg.from,
    replyTo: msg.messageId,
    text: assistantText,
  };
}
