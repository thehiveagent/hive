import fetch from "node-fetch";

import { resolveProviderApiKey } from "./api-key.js";
import {
  ProviderConfigurationError,
  ProviderRequestError,
  iterateSseData,
  type Provider,
  type ProviderMessage,
  type StreamChatRequest,
} from "./base.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  readonly defaultModel: string;
  readonly supportsTools = true;

  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.defaultModel = process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async *streamChat(request: StreamChatRequest): AsyncGenerator<string> {
    if (!this.apiKey) {
      throw new ProviderConfigurationError('Provider "anthropic" is missing ANTHROPIC_API_KEY.');
    }

    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const messages = toAnthropicMessages(request.messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model ?? this.defaultModel,
        stream: true,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature,
        system: system.length > 0 ? system : undefined,
        messages,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new ProviderRequestError(
        `anthropic request failed: HTTP ${response.status} ${response.statusText} ${bodyText}`,
      );
    }

    for await (const data of iterateSseData(response)) {
      if (data === "[DONE]") {
        return;
      }

      const payload = parseJson<Record<string, unknown>>(data);
      if (!payload) {
        continue;
      }

      if (payload.type === "error") {
        const error = payload.error as Record<string, unknown> | undefined;
        const message =
          typeof error?.message === "string" ? error.message : "anthropic stream error";

        throw new ProviderRequestError(message);
      }

      const text = pickAnthropicDelta(payload);
      if (text.length > 0) {
        yield text;
      }
    }
  }
}

export async function createAnthropicProvider(): Promise<AnthropicProvider> {
  const apiKey = await resolveProviderApiKey("anthropic", "ANTHROPIC_API_KEY");
  return new AnthropicProvider(apiKey);
}

function toAnthropicMessages(messages: ProviderMessage[]): AnthropicMessage[] {
  const filtered = messages.filter((message) => message.role !== "system");
  if (filtered.length === 0) {
    return [{ role: "user", content: "Hello." }];
  }

  return filtered.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}

function pickAnthropicDelta(payload: Record<string, unknown>): string {
  if (payload.type === "content_block_start") {
    const contentBlock = payload.content_block as Record<string, unknown> | undefined;
    if (contentBlock?.type === "text" && typeof contentBlock.text === "string") {
      return contentBlock.text;
    }
  }

  if (payload.type === "content_block_delta") {
    const delta = payload.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  if (payload.type === "message_delta") {
    const delta = payload.delta as Record<string, unknown> | undefined;
    if (typeof delta?.text === "string") {
      return delta.text;
    }
  }

  return "";
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
