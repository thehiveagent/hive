import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export class MistralProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "mistral",
      baseUrl: process.env.MISTRAL_BASE_URL ?? DEFAULT_MISTRAL_BASE_URL,
      apiKey,
      defaultModel: process.env.MISTRAL_MODEL ?? DEFAULT_MISTRAL_MODEL,
    });
  }
}

export async function createMistralProvider(): Promise<MistralProvider> {
  const apiKey = await resolveProviderApiKey("mistral", "MISTRAL_API_KEY");
  return new MistralProvider(apiKey);
}
