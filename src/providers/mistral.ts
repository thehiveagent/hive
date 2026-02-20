import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export class MistralProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      name: "mistral",
      baseUrl: process.env.MISTRAL_BASE_URL ?? DEFAULT_MISTRAL_BASE_URL,
      apiKey: process.env.MISTRAL_API_KEY,
      defaultModel: process.env.MISTRAL_MODEL ?? DEFAULT_MISTRAL_MODEL,
    });
  }
}
