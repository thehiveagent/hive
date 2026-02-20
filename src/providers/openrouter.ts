import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "openrouter",
      baseUrl: process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL,
      apiKey,
      defaultModel: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
    });
  }
}

export async function createOpenRouterProvider(): Promise<OpenRouterProvider> {
  const apiKey = await resolveProviderApiKey("openrouter", "OPENROUTER_API_KEY");
  return new OpenRouterProvider(apiKey);
}
