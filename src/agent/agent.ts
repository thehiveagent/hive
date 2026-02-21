import type {
  AgentRecord,
  ConversationRecord,
  HiveDatabase,
} from "../storage/db.js";
import { openPage, search, type SearchResult } from "../browser/browser.js";
import {
  appendMessage,
  createConversation,
  getConversationById,
  getPrimaryAgent,
  listMessages,
} from "../storage/db.js";
import {
  chunkText,
  type Provider,
  type ProviderMessage,
  type ProviderToolCall,
  type ProviderToolCallPayload,
  type ProviderToolDefinition,
  type StreamChatRequest,
} from "../providers/base.js";
import { createProvider } from "../providers/index.js";

const BROWSE_COMMAND_PATTERN = /^\/browse\s+(\S+)(?:\s+([\s\S]+))?$/i;
const SEARCH_COMMAND_PATTERN = /^\/search\s+([\s\S]+)$/i;
const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s]+)/i;
const MAX_TOOL_CALL_ROUNDS = 4;
const WEB_SEARCH_TOOL: ProviderToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the public web for current information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The query string to search for.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

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
    for await (const token of this.generateAssistantReply(providerRequest)) {
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

  private async *generateAssistantReply(
    providerRequest: StreamChatRequest,
  ): AsyncGenerator<string> {
    if (!this.provider.completeChat) {
      yield* this.provider.streamChat(providerRequest);
      return;
    }

    const assistantText = await this.completeWithAutomaticTools(providerRequest);
    yield* chunkText(assistantText);
  }

  private async completeWithAutomaticTools(
    providerRequest: StreamChatRequest,
  ): Promise<string> {
    const completeChat = this.provider.completeChat;
    if (!completeChat) {
      let fallbackText = "";
      for await (const token of this.provider.streamChat(providerRequest)) {
        fallbackText += token;
      }
      return fallbackText;
    }

    const messages: ProviderMessage[] = providerRequest.messages.map((message) => ({
      ...message,
    }));

    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
      const completion = await completeChat.call(this.provider, {
        model: providerRequest.model,
        temperature: providerRequest.temperature,
        maxTokens: providerRequest.maxTokens,
        messages,
        tools: [WEB_SEARCH_TOOL],
      });

      if (completion.toolCalls.length === 0) {
        return completion.content;
      }

      messages.push({
        role: "assistant",
        content: completion.content,
        tool_calls: toToolCallPayloads(completion.toolCalls),
      });

      const toolResponses = await this.executeToolCalls(completion.toolCalls);
      messages.push(...toolResponses);
    }

    return "I could not complete all required tool calls. Please try again.";
  }

  private async executeToolCalls(toolCalls: ProviderToolCall[]): Promise<ProviderMessage[]> {
    const toolMessages: ProviderMessage[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "web_search") {
        toolMessages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: `Unsupported tool: ${toolCall.name}`,
        });
        continue;
      }

      const query = parseWebSearchQuery(toolCall.arguments);
      if (!query) {
        toolMessages.push({
          role: "tool",
          name: toolCall.name,
          tool_call_id: toolCall.id,
          content: "Invalid search arguments. Expected JSON with a non-empty `query` field.",
        });
        continue;
      }

      const searchResult = await safelySearch(query);
      toolMessages.push({
        role: "tool",
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: formatSearchResults(searchResult),
      });
    }

    return toolMessages;
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

export async function buildBrowserAugmentedPrompt(userPrompt: string): Promise<string> {
  const browsePrompt = await handleBrowseSlashCommand(userPrompt);
  if (browsePrompt) {
    return browsePrompt;
  }

  const searchPrompt = await handleSearchSlashCommand(userPrompt);
  if (searchPrompt) {
    return searchPrompt;
  }

  const urlMatch = userPrompt.match(URL_PATTERN);
  if (!urlMatch) {
    return userPrompt;
  }

  const detectedUrl = normalizeUrlToken(urlMatch[1]);
  if (!detectedUrl) {
    return userPrompt;
  }

  return buildBrowserContextMessage({
    sourceLabel: `Browser content from ${detectedUrl}`,
    userPrompt,
    content: await safelyOpenPage(detectedUrl),
  });
}

export async function handleBrowseSlashCommand(
  userPrompt: string,
): Promise<string | null> {
  const match = userPrompt.trim().match(BROWSE_COMMAND_PATTERN);
  if (!match) {
    return null;
  }

  const candidateUrl = match[1];
  const customQuestion = match[2]?.trim();
  const normalizedUrl = normalizeUrlToken(candidateUrl);
  if (!normalizedUrl) {
    return buildBrowserContextMessage({
      sourceLabel: "Browse error",
      userPrompt: userPrompt.trim(),
      content:
        "Invalid URL. Use `/browse <url>` with an http(s) URL or a domain like `example.com`.",
    });
  }

  return buildBrowserContextMessage({
    sourceLabel: `Browser content from ${normalizedUrl}`,
    userPrompt:
      customQuestion && customQuestion.length > 0
        ? customQuestion
        : `Summarize the key information from ${normalizedUrl}.`,
    content: await safelyOpenPage(normalizedUrl),
  });
}

export async function handleSearchSlashCommand(
  userPrompt: string,
): Promise<string | null> {
  const match = userPrompt.trim().match(SEARCH_COMMAND_PATTERN);
  if (!match) {
    return null;
  }

  const query = match[1].trim();
  if (query.length === 0) {
    return buildBrowserContextMessage({
      sourceLabel: "Search error",
      userPrompt,
      content: "Search query is empty. Use `/search <query>`.",
    });
  }

  const results = await safelySearch(query);
  return buildBrowserContextMessage({
    sourceLabel: `Search results for \"${query}\"`,
    userPrompt: query,
    content: formatSearchResults(results),
  });
}

function buildBrowserContextMessage(input: {
  sourceLabel: string;
  content: string;
  userPrompt: string;
}): string {
  return `[${input.sourceLabel}]:\n${input.content}\n\nUser question: ${input.userPrompt}`;
}

async function safelyOpenPage(url: string): Promise<string> {
  try {
    return await openPage(url);
  } catch (error) {
    return `Unable to read that page right now. ${errorMessage(error)}`;
  }
}

async function safelySearch(query: string): Promise<SearchResult[] | string> {
  try {
    return await search(query);
  } catch (error) {
    return `Unable to search the web right now. ${errorMessage(error)}`;
  }
}

function formatSearchResults(results: SearchResult[] | string): string {
  if (typeof results === "string") {
    return results;
  }

  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .map((result, index) => {
      const snippet = result.snippet.length > 0 ? result.snippet : "(no snippet)";
      return `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${snippet}`;
    })
    .join("\n\n");
}

function normalizeUrlToken(value: string): string | null {
  const cleaned = value.trim().replace(/[),.;!?]+$/, "");
  if (cleaned.length === 0) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : `https://${cleaned.replace(/^\/\//, "")}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toToolCallPayloads(toolCalls: ProviderToolCall[]): ProviderToolCallPayload[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  }));
}

function parseWebSearchQuery(rawArguments: string): string | null {
  const trimmed = rawArguments.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const query = parsed.query;
    if (typeof query === "string" && query.trim().length > 0) {
      return query.trim();
    }
  } catch {
    // Fall through to plain-string handling below.
  }

  if (trimmed.length > 0 && !trimmed.startsWith("{")) {
    return trimmed;
  }

  return null;
}
