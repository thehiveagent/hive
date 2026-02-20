import {
  normalizeProviderName,
  type Provider,
  type ProviderName,
} from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { GroqProvider } from "./groq.js";
import { MistralProvider } from "./mistral.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(name?: string): Provider {
  const resolvedName = normalizeProviderName(name ?? process.env.HIVE_PROVIDER);

  switch (resolvedName) {
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    case "ollama":
      return new OllamaProvider();
    case "groq":
      return new GroqProvider();
    case "mistral":
      return new MistralProvider();
    default:
      return assertNever(resolvedName);
  }
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
    default:
      return assertNever(name);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}
