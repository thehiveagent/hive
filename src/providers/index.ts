import { normalizeProviderName, type Provider, type ProviderName } from "./base.js";
import { AnthropicProvider, createAnthropicProvider } from "./anthropic.js";
import { GoogleProvider, createGoogleProvider } from "./google.js";
import { GroqProvider, createGroqProvider } from "./groq.js";
import { MistralProvider, createMistralProvider } from "./mistral.js";
import { OllamaProvider, createOllamaProvider } from "./ollama.js";
import { OpenAIProvider, createOpenAIProvider } from "./openai.js";
import { OpenRouterProvider, createOpenRouterProvider } from "./openrouter.js";
import { TogetherProvider, createTogetherProvider } from "./together.js";
import { withFirstTokenTimeout } from "./resilience.js";

export async function createProvider(name?: string): Promise<Provider> {
  const resolvedName = normalizeProviderName(name ?? process.env.HIVE_PROVIDER);

  switch (resolvedName) {
    case "openai":
      return createOpenAIProvider();
    case "anthropic":
      return createAnthropicProvider();
    case "ollama":
      return createOllamaProvider();
    case "groq":
      return createGroqProvider();
    case "mistral":
      return createMistralProvider();
    case "google":
      return createGoogleProvider();
    case "openrouter":
      return createOpenRouterProvider();
    case "together":
      return createTogetherProvider();
    default:
      return assertNever(resolvedName);
  }
}

export async function createProviderWithKey(name: string, apiKey?: string): Promise<Provider> {
  const resolvedName = normalizeProviderName(name);

  switch (resolvedName) {
    case "openai":
      return new OpenAIProvider(apiKey);
    case "anthropic":
      return new AnthropicProvider(apiKey);
    case "ollama":
      return new OllamaProvider(apiKey);
    case "groq":
      return new GroqProvider(apiKey);
    case "mistral":
      return new MistralProvider(apiKey);
    case "google":
      return new GoogleProvider(apiKey);
    case "openrouter":
      return new OpenRouterProvider(apiKey);
    case "together":
      return new TogetherProvider(apiKey);
    default:
      return assertNever(resolvedName);
  }
}

export async function pingProvider(provider: Provider, model?: string): Promise<void> {
  const stream = withFirstTokenTimeout(
    provider.streamChat({
      model: model ?? provider.defaultModel,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 1,
    }),
    5_000,
  );

  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
}

export function getDefaultModelForProvider(name: ProviderName): string {
  switch (name) {
    case "openai":
      return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
    case "ollama":
      return process.env.OLLAMA_MODEL ?? "llama3.2";
    case "groq":
      return process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    case "mistral":
      return process.env.MISTRAL_MODEL ?? "mistral-small-latest";
    case "google":
      return process.env.GOOGLE_MODEL ?? "gemini-2.0-flash";
    case "openrouter":
      return process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
    case "together":
      return process.env.TOGETHER_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo";
    default:
      return assertNever(name);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}
