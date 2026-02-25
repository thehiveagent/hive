import inquirer from "inquirer";
import fetch from "node-fetch";

import { SUPPORTED_PROVIDER_NAMES, type ProviderName } from "../../providers/base.js";

type HostedProviderName = Exclude<ProviderName, "ollama">;

const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";

const MODEL_CHOICES_BY_PROVIDER: Record<HostedProviderName, readonly string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "o1"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  google: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-pro-exp-02-05"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001"],
  together: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "meta-llama/Llama-3.1-8B-Instruct-Turbo",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
  ],
};

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface PromptForProviderOptions {
  message?: string;
  defaultProvider?: ProviderName;
}

interface PromptForModelOptions {
  message?: string;
  defaultModel?: string;
}

export async function promptForProvider(
  options: PromptForProviderOptions = {},
): Promise<ProviderName> {
  const answer = (await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: options.message ?? "Choose a provider",
      choices: SUPPORTED_PROVIDER_NAMES.map((value) => ({
        name: value,
        value,
      })),
      default: options.defaultProvider,
    },
  ])) as { provider: ProviderName };

  return answer.provider;
}

export async function promptForModel(
  provider: ProviderName,
  options: PromptForModelOptions = {},
): Promise<string> {
  const promptMessage = options.message ?? "Choose a model";

  if (provider === "ollama") {
    const ollamaModels = await fetchOllamaModels();

    if (ollamaModels && ollamaModels.length > 0) {
      const defaultSelection =
        options.defaultModel && ollamaModels.includes(options.defaultModel)
          ? [options.defaultModel]
          : undefined;

      const answer = (await inquirer.prompt([
        {
          type: "checkbox",
          name: "model",
          message: promptMessage,
          choices: ollamaModels.map((value) => ({
            name: value,
            value,
          })),
          default: defaultSelection,
          validate: (values: string[]) => values.length === 1 || "Select exactly one model.",
        },
      ])) as { model: string[] };

      return answer.model[0];
    }

    const fallbackMessage =
      ollamaModels === null
        ? "Ollama not detected. Enter model name manually:"
        : "No local Ollama models found. Enter model name manually:";

    const answer = (await inquirer.prompt([
      {
        type: "input",
        name: "model",
        message: fallbackMessage,
        validate: requiredField("Model is required."),
      },
    ])) as { model: string };

    return answer.model.trim();
  }

  const modelChoices = MODEL_CHOICES_BY_PROVIDER[provider];
  const defaultModel =
    options.defaultModel && modelChoices.includes(options.defaultModel)
      ? options.defaultModel
      : undefined;

  const answer = (await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: promptMessage,
      choices: modelChoices.map((value) => ({
        name: value,
        value,
      })),
      default: defaultModel,
    },
  ])) as { model: string };

  return answer.model;
}

async function fetchOllamaModels(): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 1000);

  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    if (!Array.isArray(payload.models)) {
      return [];
    }

    return Array.from(
      new Set(
        payload.models
          .map((entry) => {
            if (typeof entry.name === "string" && entry.name.trim().length > 0) {
              return entry.name.trim();
            }

            if (typeof entry.model === "string" && entry.model.trim().length > 0) {
              return entry.model.trim();
            }

            return "";
          })
          .filter((value) => value.length > 0),
      ),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function requiredField(message: string): (value: string) => true | string {
  return (value: string) => {
    if (value.trim().length > 0) {
      return true;
    }

    return message;
  };
}
