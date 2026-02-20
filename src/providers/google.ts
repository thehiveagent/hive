import { resolveProviderApiKey } from "./api-key.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GOOGLE_MODEL = "gemini-3.0-flash";

export class GoogleProvider extends OpenAICompatibleProvider {
  constructor(apiKey?: string) {
    super({
      name: "google",
      baseUrl: process.env.GOOGLE_BASE_URL ?? DEFAULT_GOOGLE_BASE_URL,
      apiKey,
      defaultModel: process.env.GOOGLE_MODEL ?? DEFAULT_GOOGLE_MODEL,
    });
  }
}

export async function createGoogleProvider(): Promise<GoogleProvider> {
  const apiKey = await resolveProviderApiKey("google", "GOOGLE_API_KEY");
  return new GoogleProvider(apiKey);
}
