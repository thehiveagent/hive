import {
  completeOpenAICompatibleChat,
  type CompleteChatRequest,
  type CompleteChatResponse,
  ProviderConfigurationError,
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
}

export class OpenAICompatibleProvider implements Provider {
  readonly name: ProviderName;
  readonly defaultModel: string;

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
  }

  async *streamChat(request: StreamChatRequest): AsyncGenerator<string> {
    if (!this.allowMissingApiKey && !this.apiKey) {
      throw new ProviderConfigurationError(
        `Provider "${this.name}" is missing an API key.`,
      );
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
      throw new ProviderConfigurationError(
        `Provider "${this.name}" is missing an API key.`,
      );
    }

    return completeOpenAICompatibleChat({
      provider: this.name,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      tools: request.tools,
      extraHeaders: this.extraHeaders,
      extraBody: this.extraBody,
    });
  }
}
