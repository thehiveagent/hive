import type {
  AgentRecord,
  ConversationRecord,
  HiveDatabase,
} from "../storage/db.js";
import {
  appendMessage,
  createConversation,
  getConversationById,
  getPrimaryAgent,
  listMessages,
} from "../storage/db.js";
import type { Provider, StreamChatRequest } from "../providers/base.js";
import { createProvider } from "../providers/index.js";

export interface AgentChatOptions {
  conversationId?: string;
  title?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export type AgentStreamEvent =
  | {
      type: "token";
      conversationId: string;
      token: string;
    }
  | {
      type: "done";
      conversationId: string;
      assistantMessageId: string;
    };

export class HiveAgent {
  private readonly historyLimit = 80;

  constructor(
    private readonly db: HiveDatabase,
    private readonly provider: Provider,
    private readonly agent: AgentRecord,
  ) {}

  static async load(db: HiveDatabase, provider?: Provider): Promise<HiveAgent> {
    const agent = getPrimaryAgent(db);
    if (!agent) {
      throw new Error("Hive is not initialized. Run `hive init` first.");
    }

    const resolvedProvider = provider ?? (await createProvider(agent.provider));
    return new HiveAgent(db, resolvedProvider, agent);
  }

  getProfile(): AgentRecord {
    return this.agent;
  }

  startConversation(title?: string): ConversationRecord {
    return createConversation(this.db, {
      agentId: this.agent.id,
      title,
    });
  }

  async *chat(
    userMessage: string,
    options: AgentChatOptions = {},
  ): AsyncGenerator<AgentStreamEvent> {
    const trimmed = userMessage.trim();
    if (trimmed.length === 0) {
      throw new Error("Cannot send an empty message.");
    }

    const conversation = this.resolveConversation(options.conversationId, options.title);

    appendMessage(this.db, {
      conversationId: conversation.id,
      role: "user",
      content: trimmed,
    });

    const history = listMessages(this.db, conversation.id, this.historyLimit);
    const providerRequest: StreamChatRequest = {
      model: options.model ?? this.agent.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      messages: [
        {
          role: "system",
          content: this.agent.persona,
        },
        ...history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    };

    let assistantText = "";
    for await (const token of this.provider.streamChat(providerRequest)) {
      assistantText += token;
      yield {
        type: "token",
        conversationId: conversation.id,
        token,
      };
    }

    const savedMessage = appendMessage(this.db, {
      conversationId: conversation.id,
      role: "assistant",
      content: assistantText,
    });

    yield {
      type: "done",
      conversationId: conversation.id,
      assistantMessageId: savedMessage.id,
    };
  }

  private resolveConversation(
    conversationId?: string,
    title?: string,
  ): ConversationRecord {
    if (!conversationId) {
      return createConversation(this.db, {
        agentId: this.agent.id,
        title,
      });
    }

    const existingConversation = getConversationById(this.db, conversationId);
    if (!existingConversation) {
      throw new Error(`Conversation \"${conversationId}\" was not found.`);
    }

    if (existingConversation.agent_id !== this.agent.id) {
      throw new Error("Conversation does not belong to the initialized Hive agent.");
    }

    return existingConversation;
  }
}

export function buildDefaultPersona(ownerName: string): string {
  return [
    "You are The Hive: a local-first personal AI agent.",
    `You are assisting ${ownerName}.`,
    "Be direct, useful, and execution-focused.",
    "Prefer concrete actions over abstract advice.",
    "If context is missing, ask one concise clarifying question.",
  ].join("\n");
}
