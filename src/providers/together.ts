import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_TOGETHER_BASE_URL = "https://api.together.xyz/v1";
const DEFAULT_TOGETHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

export class TogetherProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "together",
      baseUrl: process.env.TOGETHER_BASE_URL ?? DEFAULT_TOGETHER_BASE_URL,
      apiKey,
      defaultModel: process.env.TOGETHER_MODEL ?? DEFAULT_TOGETHER_MODEL,
    });
  }
}

export async function createTogetherProvider(): Promise<TogetherProvider> {
  const apiKey = await resolveProviderApiKey("together", "TOGETHER_API_KEY");
  return new TogetherProvider(apiKey);
}
