import chalk from "chalk";

import {
  completeOpenAICompatibleChat,
  type CompleteChatRequest,
  type CompleteChatResponse,
  ProviderConfigurationError,
  ProviderRequestError,
  type Provider,
  type ProviderName,
  type StreamChatRequest,
  streamOpenAICompatibleChat,
} from "./base.js";

export interface OpenAICompatibleProviderConfig {
  name: ProviderName;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  allowMissingApiKey?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  supportsTools?: boolean;
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: ProviderName;
  readonly defaultModel: string;
  readonly supportsTools: boolean;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly allowMissingApiKey: boolean;
  private readonly extraHeaders?: Record<string, string>;
  private readonly extraBody?: Record<string, unknown>;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
    this.allowMissingApiKey = config.allowMissingApiKey ?? false;
    this.extraHeaders = config.extraHeaders;
    this.extraBody = config.extraBody;
    this.supportsTools = config.supportsTools ?? true;
  }

  async *streamChat(request: StreamChatRequest): AsyncGenerator<string> {
    if (!this.allowMissingApiKey && !this.apiKey) {
      throw new ProviderConfigurationError(`Provider "${this.name}" is missing an API key.`);
    }

    yield* streamOpenAICompatibleChat({
      provider: this.name,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      extraHeaders: this.extraHeaders,
      extraBody: this.extraBody,
    });
  }

  async completeChat(request: CompleteChatRequest): Promise<CompleteChatResponse> {
    if (!this.allowMissingApiKey && !this.apiKey) {
      throw new ProviderConfigurationError(`Provider "${this.name}" is missing an API key.`);
    }

    try {
      return await this.completeChatInternal(request, { includeTools: this.supportsTools });
    } catch (error) {
      if (this.shouldRetryWithoutTools(error, request)) {
        process.stderr.write(chalk.dim("· tool call failed — retrying without tools") + "\n");
        return await this.completeChatInternal(request, { includeTools: false });
      }

      throw error;
    }
  }

  private completeChatInternal(
    request: CompleteChatRequest,
    options: { includeTools: boolean },
  ): Promise<CompleteChatResponse> {
    return completeOpenAICompatibleChat({
      provider: this.name,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      tools: options.includeTools ? request.tools : undefined,
      extraHeaders: this.extraHeaders,
      extraBody: this.extraBody,
    });
  }

  private shouldRetryWithoutTools(error: unknown, request: CompleteChatRequest): boolean {
    if (this.name !== "groq") {
      return false;
    }

    if (!this.supportsTools || !request.tools || request.tools.length === 0) {
      return false;
    }

    if (!(error instanceof ProviderRequestError)) {
      return false;
    }

    const message = error.message.toLowerCase();
    const is400 =
      message.includes("http 400") ||
      message.includes("status 400") ||
      message.includes(" 400 ");

    return is400 && message.includes("tool_use_failed");
  }
}
