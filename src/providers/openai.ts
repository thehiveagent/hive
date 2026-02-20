import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "openai",
      baseUrl: process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
      apiKey,
      defaultModel: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    });
  }
}

export async function createOpenAIProvider(): Promise<OpenAIProvider> {
  const apiKey = await resolveProviderApiKey("openai", "OPENAI_API_KEY");
  return new OpenAIProvider(apiKey);
}
