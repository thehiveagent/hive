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
  BUILT_IN_THEMES,
  DEFAULT_THEME_HEX,
  applyTheme,
  getTheme,
  isValidHexColor,
  type ThemeName,
} from "../theme.js";
import {
  closeHiveDatabase,
  getPrimaryAgent,
  openHiveDatabase,
  setMetaValue,
  updatePrimaryAgentModel,
  updatePrimaryAgentProviderAndModel,
} from "../../storage/db.js";

const KEYCHAIN_SERVICE = "hive";
const THEME_LABEL_WIDTH = 8;

interface ConfigShowRenderOptions {
  showHeader?: boolean;
}

interface ConfigInteractiveRenderOptions {
  showHeader?: boolean;
}

export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command("config")
    .description("Update provider, model, theme, or API keys without re-running init");

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

  configCommand
    .command("theme")
    .description("Change CLI accent theme")
    .action(async () => {
      await runConfigThemeCommand();
    });

  configCommand.action(() => {
    renderHiveHeader("Config");
    configCommand.outputHelp();
  });
}

export async function runConfigProviderCommand(): Promise<void> {
  await runConfigProviderCommandWithOptions();
}

export async function runConfigProviderCommandWithOptions(
  options: ConfigInteractiveRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Config · Provider");
  }
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
    renderStep("Run `hive` to use it.");
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
  await runConfigModelCommandWithOptions();
}

export async function runConfigModelCommandWithOptions(
  options: ConfigInteractiveRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Config · Model");
  }
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
    renderStep("Run `hive` to use it.");
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
  await runConfigKeyCommandWithOptions();
}

export async function runConfigKeyCommandWithOptions(
  options: ConfigInteractiveRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Config · Key");
  }
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
    renderStep("Run `hive` to use it.");
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
  await runConfigShowCommandWithOptions();
}

export async function runConfigThemeCommand(): Promise<void> {
  await runConfigThemeCommandWithOptions();
}

export async function runConfigShowCommandWithOptions(
  options: ConfigShowRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Config · Show");
  }

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

export async function runConfigThemeCommandWithOptions(
  options: ConfigInteractiveRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Config · Theme");
  }

  const spinner = ora("Loading themes...").start();
  const db = openHiveDatabase();

  try {
    ensureInteractiveTerminal("`hive config theme` requires an interactive terminal.");

    const currentTheme = getTheme();
    const customDotHex = currentTheme.name === "custom" ? currentTheme.hex : DEFAULT_THEME_HEX;
    const themeChoices = [
      {
        name: formatThemeChoice("amber", BUILT_IN_THEMES.amber, "default — beehive"),
        value: "amber",
      },
      {
        name: formatThemeChoice("cyan", BUILT_IN_THEMES.cyan),
        value: "cyan",
      },
      {
        name: formatThemeChoice("rose", BUILT_IN_THEMES.rose),
        value: "rose",
      },
      {
        name: formatThemeChoice("slate", BUILT_IN_THEMES.slate),
        value: "slate",
      },
      {
        name: formatThemeChoice("green", BUILT_IN_THEMES.green),
        value: "green",
      },
      {
        name: formatThemeChoice("custom", customDotHex, "user provided hex"),
        value: "custom",
      },
    ] as const;

    spinner.stop();

    const { theme } = (await inquirer.prompt([
      {
        type: "list",
        name: "theme",
        message: "Select a theme:",
        default: currentTheme.name,
        choices: themeChoices,
      },
    ])) as { theme: ThemeName };

    let themeHex = theme === "custom" ? currentTheme.hex : BUILT_IN_THEMES[theme];

    if (theme === "custom") {
      const answer = (await inquirer.prompt([
        {
          type: "input",
          name: "hex",
          message: "Enter hex color: #",
          default: currentTheme.name === "custom" ? currentTheme.hex : undefined,
          validate: validateHexColor,
        },
      ])) as { hex: string };

      themeHex = normalizeHexColor(answer.hex);
    }

    spinner.start("Saving theme...");
    setMetaValue(db, "theme", theme);
    setMetaValue(db, "theme_hex", themeHex);
    spinner.succeed("Theme saved.");

    console.log(applyTheme(themeHex)("✓ Theme set. The Hive is now yours."));
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Failed to update theme.");
    }
    throw error;
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

function formatThemeChoice(name: string, hex: string, description?: string): string {
  const dot = applyTheme(hex)("●");
  const paddedName = name.padEnd(THEME_LABEL_WIDTH, " ");
  const descriptionSuffix = description ? ` (${description})` : "";
  return `${dot} ${paddedName} ${hex}${descriptionSuffix}`;
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

function validateHexColor(value: string): true | string {
  return isValidHexColor(value.trim()) || "Use #RRGGBB format.";
}

function normalizeHexColor(value: string): string {
  return value.trim().toUpperCase();
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}
