import fetch, { type Response } from "node-fetch";

export const SUPPORTED_PROVIDER_NAMES = [
  "openai",
  "anthropic",
  "ollama",
  "groq",
  "mistral",
  "google",
  "openrouter",
  "together",
] as const;

export type ProviderName = (typeof SUPPORTED_PROVIDER_NAMES)[number];
export type ProviderMessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCallPayload {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ProviderToolCallPayload[];
}

export interface StreamChatRequest {
  messages: ProviderMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompleteChatRequest extends StreamChatRequest {
  tools?: ProviderToolDefinition[];
}

export interface CompleteChatResponse {
  content: string;
  toolCalls: ProviderToolCall[];
}

export interface Provider {
  readonly name: ProviderName;
  readonly defaultModel: string;
  streamChat(request: StreamChatRequest): AsyncGenerator<string>;
  completeChat?(request: CompleteChatRequest): Promise<CompleteChatResponse>;
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export interface OpenAICompatibleStreamInput {
  provider: ProviderName;
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface OpenAICompatibleCompleteInput extends OpenAICompatibleStreamInput {
  tools?: ProviderToolDefinition[];
}

export function normalizeProviderName(raw?: string): ProviderName {
  if (!raw) {
    return "openai";
  }

  const normalized = raw.trim().toLowerCase();
  if ((SUPPORTED_PROVIDER_NAMES as readonly string[]).includes(normalized)) {
    return normalized as ProviderName;
  }

  throw new ProviderConfigurationError(
    `Unsupported provider "${raw}". Supported providers: ${SUPPORTED_PROVIDER_NAMES.join(", ")}.`,
  );
}

export async function* streamOpenAICompatibleChat(
  input: OpenAICompatibleStreamInput,
): AsyncGenerator<string> {
  const endpoint = `${input.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.extraHeaders ?? {}),
  };

  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: true,
    ...(input.extraBody ?? {}),
  };

  if (input.temperature !== undefined) {
    body.temperature = input.temperature;
  }

  if (input.maxTokens !== undefined) {
    body.max_tokens = input.maxTokens;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  await ensureOk(response, `${input.provider} request failed`);

  for await (const data of iterateSseData(response)) {
    if (data === "[DONE]") {
      return;
    }

    const payload = parseJson<Record<string, unknown>>(data);
    if (!payload) {
      continue;
    }

    const errorMessage = pickErrorMessage(payload);
    if (errorMessage) {
      throw new ProviderRequestError(`${input.provider} error: ${errorMessage}`);
    }

    const maybeChoices = payload.choices;
    if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
      continue;
    }

    const firstChoice = maybeChoices[0] as Record<string, unknown>;
    const delta = firstChoice.delta as Record<string, unknown> | undefined;

    const text =
      typeof delta?.content === "string"
        ? delta.content
        : typeof firstChoice.text === "string"
          ? firstChoice.text
          : "";

    if (text.length > 0) {
      yield text;
    }
  }
}

export async function completeOpenAICompatibleChat(
  input: OpenAICompatibleCompleteInput,
): Promise<CompleteChatResponse> {
  const endpoint = `${input.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.extraHeaders ?? {}),
  };

  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: false,
    ...(input.extraBody ?? {}),
  };

  if (input.temperature !== undefined) {
    body.temperature = input.temperature;
  }

  if (input.maxTokens !== undefined) {
    body.max_tokens = input.maxTokens;
  }

  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  await ensureOk(response, `${input.provider} request failed`);

  const payload = (await response.json()) as Record<string, unknown>;
  const errorMessage = pickErrorMessage(payload);
  if (errorMessage) {
    throw new ProviderRequestError(`${input.provider} error: ${errorMessage}`);
  }

  const maybeChoices = payload.choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    throw new ProviderRequestError(`${input.provider} response did not include choices.`);
  }

  const firstChoice = maybeChoices[0] as Record<string, unknown>;
  const message = firstChoice.message as Record<string, unknown> | undefined;

  const content = pickMessageContent(message);
  const toolCalls = pickToolCalls(message);

  return {
    content,
    toolCalls,
  };
}

export async function* iterateSseData(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    return;
  }

  let buffer = "";

  for await (const chunk of response.body) {
    buffer += chunk.toString("utf8").replace(/\r\n/g, "\n");

    let eventBoundary = buffer.indexOf("\n\n");
    while (eventBoundary !== -1) {
      const rawEvent = buffer.slice(0, eventBoundary);
      buffer = buffer.slice(eventBoundary + 2);

      const data = parseSseData(rawEvent);
      if (data !== null) {
        yield data;
      }

      eventBoundary = buffer.indexOf("\n\n");
    }
  }

  const remaining = parseSseData(buffer);
  if (remaining !== null) {
    yield remaining;
  }
}

export async function* chunkText(text: string, chunkSize = 32): AsyncGenerator<string> {
  for (let start = 0; start < text.length; start += chunkSize) {
    yield text.slice(start, start + chunkSize);
  }
}

function parseSseData(rawEvent: string): string | null {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (lines.length === 0) {
    return null;
  }

  return lines.join("\n").trim();
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function pickErrorMessage(payload: Record<string, unknown>): string | null {
  const maybeError = payload.error;
  if (typeof maybeError === "string") {
    return maybeError;
  }

  if (maybeError && typeof maybeError === "object") {
    const message = (maybeError as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return null;
}

function pickMessageContent(message: Record<string, unknown> | undefined): string {
  if (!message) {
    return "";
  }

  const rawContent = message.content;
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const asRecord = part as Record<string, unknown>;
          if (typeof asRecord.text === "string") {
            return asRecord.text;
          }
        }

        return "";
      })
      .join("");
  }

  return "";
}

function pickToolCalls(message: Record<string, unknown> | undefined): ProviderToolCall[] {
  if (!message) {
    return [];
  }

  const rawToolCalls = message.tool_calls;
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  const calls: ProviderToolCall[] = [];
  for (const toolCall of rawToolCalls) {
    if (!toolCall || typeof toolCall !== "object") {
      continue;
    }

    const callRecord = toolCall as Record<string, unknown>;
    const callId = typeof callRecord.id === "string" ? callRecord.id : "";
    const callFunction = callRecord.function as Record<string, unknown> | undefined;
    const callName = typeof callFunction?.name === "string" ? callFunction.name : "";
    const callArguments =
      typeof callFunction?.arguments === "string" ? callFunction.arguments : "{}";

    if (callId.length === 0 || callName.length === 0) {
      continue;
    }

    calls.push({
      id: callId,
      name: callName,
      arguments: callArguments,
    });
  }

  return calls;
}

async function ensureOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const bodyText = (await response.text()).trim();
  const details = bodyText.length > 0 ? ` ${bodyText}` : "";

  throw new ProviderRequestError(
    `${fallbackMessage}: HTTP ${response.status} ${response.statusText}${details}`,
  );
}
