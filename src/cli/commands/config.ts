import process from "node:process";

import { Command } from "commander";
import inquirer from "inquirer";
import keytar from "keytar";
import ora from "ora";

import { resolveProviderApiKey } from "../../providers/api-key.js";
import { normalizeProviderName, type ProviderName } from "../../providers/base.js";
import { promptForModel, promptForProvider } from "../helpers/providerPrompts.js";
import {
  renderError,
  renderHiveHeader,
  renderInfo,
  renderStep,
  renderSuccess,
} from "../ui.js";
import {
  closeHiveDatabase,
  getPrimaryAgent,
  openHiveDatabase,
  setMetaValue,
  updatePrimaryAgentModel,
  updatePrimaryAgentProviderAndModel,
} from "../../storage/db.js";

const KEYCHAIN_SERVICE = "hive";

export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command("config")
    .description("Update provider, model, or API keys without re-running init");

  configCommand
    .command("provider")
    .description("Change provider, model, and API key")
    .action(async () => {
      await runConfigProviderCommand();
    });

  configCommand
    .command("model")
    .description("Change model for the current provider")
    .action(async () => {
      await runConfigModelCommand();
    });

  configCommand
    .command("key")
    .description("Update API key for the current provider")
    .action(async () => {
      await runConfigKeyCommand();
    });

  configCommand
    .command("show")
    .description("Show current provider, model, and key status")
    .action(async () => {
      await runConfigShowCommand();
    });

  configCommand.action(() => {
    renderHiveHeader();
    configCommand.outputHelp();
  });
}

export async function runConfigProviderCommand(): Promise<void> {
  renderHiveHeader();
  const spinner = ora("Loading configuration...").start();
  const db = openHiveDatabase();

  try {
    ensureInteractiveTerminal("`hive config provider` requires an interactive terminal.");

    const agent = getPrimaryAgent(db);
    if (!agent) {
      spinner.stop();
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const currentProvider = normalizeProviderName(agent.provider);
    const currentModel = agent.model;

    spinner.stop();
    printCurrentProviderAndModel(currentProvider, currentModel);

    const provider = await promptForProvider({
      defaultProvider: currentProvider,
    });
    const model = await promptForModel(provider, {
      defaultModel: provider === currentProvider ? currentModel : undefined,
    });

    let apiKey: string | undefined;
    if (provider !== "ollama") {
      const answer = (await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "Enter your API key:",
          mask: "*",
          validate: requiredField("API key is required."),
        },
      ])) as { apiKey: string };

      apiKey = answer.apiKey.trim();
    }

    spinner.start("Saving configuration...");

    const updatedAgent = updatePrimaryAgentProviderAndModel(db, {
      provider,
      model,
    });
    setMetaValue(db, "provider", updatedAgent.provider);
    setMetaValue(db, "model", updatedAgent.model);

    if (provider !== "ollama" && apiKey) {
      await keytar.setPassword(KEYCHAIN_SERVICE, provider, apiKey);
    }

    spinner.succeed("Configuration saved.");
    renderSuccess("Provider updated.");
    renderStep("Run `hive chat` to use it.");
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Failed to update provider configuration.");
    }
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runConfigModelCommand(): Promise<void> {
  renderHiveHeader();
  const spinner = ora("Loading configuration...").start();
  const db = openHiveDatabase();

  try {
    ensureInteractiveTerminal("`hive config model` requires an interactive terminal.");

    const agent = getPrimaryAgent(db);
    if (!agent) {
      spinner.stop();
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const provider = normalizeProviderName(agent.provider);
    const currentModel = agent.model;

    spinner.stop();
    printCurrentProviderAndModel(provider, currentModel);

    const model = await promptForModel(provider, {
      defaultModel: currentModel,
    });

    spinner.start("Saving model...");

    const updatedAgent = updatePrimaryAgentModel(db, model);
    setMetaValue(db, "model", updatedAgent.model);

    spinner.succeed("Configuration saved.");
    renderSuccess("Model updated.");
    renderStep("Run `hive chat` to use it.");
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Failed to update model configuration.");
    }
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runConfigKeyCommand(): Promise<void> {
  renderHiveHeader();
  const spinner = ora("Loading configuration...").start();
  const db = openHiveDatabase();

  try {
    ensureInteractiveTerminal("`hive config key` requires an interactive terminal.");

    const agent = getPrimaryAgent(db);
    if (!agent) {
      spinner.stop();
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const provider = normalizeProviderName(agent.provider);

    spinner.stop();
    renderInfo(`Current provider: ${provider}`);

    const answer = (await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Enter your API key:",
        mask: "*",
        validate: requiredField("API key is required."),
      },
    ])) as { apiKey: string };

    spinner.start("Saving key...");
    await keytar.setPassword(KEYCHAIN_SERVICE, provider, answer.apiKey.trim());

    spinner.succeed("Configuration saved.");
    renderSuccess("API key updated.");
    renderStep("Run `hive chat` to use it.");
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Failed to update API key.");
    }
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runConfigShowCommand(): Promise<void> {
  renderHiveHeader();
  const db = openHiveDatabase();

  try {
    const agent = getPrimaryAgent(db);
    if (!agent) {
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const provider = normalizeProviderName(agent.provider);
    const keyStatus = await getKeyStatus(provider);

    renderStep(`Provider: ${provider}`);
    renderStep(`Model: ${agent.model}`);
    renderStep(`Agent name: ${agent.agent_name ?? "not set"}`);
    renderStep(`API key: ${keyStatus}`);
  } finally {
    closeHiveDatabase(db);
  }
}

function ensureInteractiveTerminal(errorMessage: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(errorMessage);
  }
}

function printCurrentProviderAndModel(provider: ProviderName, model: string): void {
  renderInfo(`Current provider: ${provider}`);
  renderInfo(`Current model: ${model}`);
}

async function getKeyStatus(provider: ProviderName): Promise<"set" | "not set"> {
  const apiKey = await resolveProviderApiKey(provider, apiKeyEnvVar(provider));
  return apiKey ? "set" : "not set";
}

function apiKeyEnvVar(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "ollama":
      return "OLLAMA_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "together":
      return "TOGETHER_API_KEY";
    default:
      return assertNever(provider);
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

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}
