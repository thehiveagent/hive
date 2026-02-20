import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      name: "openai",
      baseUrl: process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    });
  }
}
