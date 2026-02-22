import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "ollama",
      baseUrl: process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
      apiKey,
      defaultModel: process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
      allowMissingApiKey: true,
      supportsTools: false,
    });
  }
}

export async function createOllamaProvider(): Promise<OllamaProvider> {
  const apiKey = await resolveProviderApiKey("ollama", "OLLAMA_API_KEY");
  return new OllamaProvider(apiKey);
}
