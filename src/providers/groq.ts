import { OpenAICompatibleProvider } from "./openai-compatible.js";

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export class GroqProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      name: "groq",
      baseUrl: process.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL,
      apiKey: process.env.GROQ_API_KEY,
      defaultModel: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    });
  }
}
