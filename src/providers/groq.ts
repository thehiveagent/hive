import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "groq",
      baseUrl: process.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL,
      apiKey,
      defaultModel: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      supportsTools: true,
    });
  }
}

export async function createGroqProvider(): Promise<GroqProvider> {
  const apiKey = await resolveProviderApiKey("groq", "GROQ_API_KEY");
  return new GroqProvider(apiKey);
}
