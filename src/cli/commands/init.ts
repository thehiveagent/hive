import process from "node:process";

import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";

import { buildDefaultPersona } from "../../agent/agent.js";
import {
  closeHiveDatabase,
  getPrimaryAgent,
  openHiveDatabase,
  setMetaValue,
  upsertPrimaryAgent,
} from "../../storage/db.js";
import {
  SUPPORTED_PROVIDER_NAMES,
  normalizeProviderName,
  type ProviderName,
} from "../../providers/base.js";
import { getDefaultModelForProvider } from "../../providers/index.js";

interface InitCommandOptions {
  name?: string;
  provider?: string;
  model?: string;
  force?: boolean;
}

interface ResolvedInitConfig {
  name: string;
  provider: ProviderName;
  model: string;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Birth your local Hive agent")
    .option("-n, --name <name>", "operator name")
    .option(
      "-p, --provider <provider>",
      `provider (${SUPPORTED_PROVIDER_NAMES.join(", ")})`,
    )
    .option("-m, --model <model>", "model name override")
    .option("--force", "overwrite existing local agent profile", false)
    .action(async (options: InitCommandOptions) => {
      await runInitCommand(options);
    });
}

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const spinner = ora("Initializing Hive...").start();
  const db = openHiveDatabase();

  try {
    const existing = getPrimaryAgent(db);
    if (existing && !options.force) {
      spinner.stop();
      console.log(chalk.yellow("Hive is already initialized."));
      console.log(
        chalk.dim(
          `Agent: ${existing.name} | Provider: ${existing.provider} | Model: ${existing.model}`,
        ),
      );
      console.log(chalk.dim("Use `hive init --force` to overwrite the profile."));
      return;
    }

    const config = await resolveInitConfig(options, existing);
    const persona = buildDefaultPersona(config.name);

    const agent = upsertPrimaryAgent(db, {
      name: config.name,
      provider: config.provider,
      model: config.model,
      persona,
    });

    setMetaValue(db, "initialized_at", new Date().toISOString());
    setMetaValue(db, "provider", agent.provider);
    setMetaValue(db, "model", agent.model);

    spinner.succeed("Hive is alive.");
    console.log(chalk.green(`Agent: ${agent.name}`));
    console.log(chalk.green(`Provider: ${agent.provider}`));
    console.log(chalk.green(`Model: ${agent.model}`));
    console.log(chalk.dim("Run `hive chat` to start talking."));
  } catch (error) {
    spinner.fail("Hive initialization failed.");
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

async function resolveInitConfig(
  options: InitCommandOptions,
  existing: { name: string; provider: string; model: string } | null,
): Promise<ResolvedInitConfig> {
  const defaultName =
    options.name?.trim() ||
    existing?.name ||
    process.env.HIVE_NAME ||
    process.env.USER ||
    "Operator";

  let provider = normalizeProviderName(
    options.provider ?? existing?.provider ?? process.env.HIVE_PROVIDER,
  );

  let model =
    options.model?.trim() ||
    existing?.model ||
    getDefaultModelForProvider(provider);

  let name = defaultName;

  if (process.stdin.isTTY) {
    const questions: Array<Record<string, unknown>> = [];

    if (!options.name) {
      questions.push({
        type: "input",
        name: "name",
        message: "Who owns this Hive node?",
        default: defaultName,
      });
    }

    if (!options.provider && !existing?.provider && !process.env.HIVE_PROVIDER) {
      questions.push({
        type: "list",
        name: "provider",
        message: "Choose your default provider",
        choices: SUPPORTED_PROVIDER_NAMES.map((value) => ({
          name: value,
          value,
        })),
        default: provider,
      });
    }

    if (!options.model) {
      questions.push({
        type: "input",
        name: "model",
        message: "Default model",
        default: model,
      });
    }

    if (questions.length > 0) {
      const answers = (await inquirer.prompt(questions)) as {
        name?: string;
        provider?: string;
        model?: string;
      };

      if (answers.name) {
        name = answers.name.trim();
      }

      if (answers.provider) {
        provider = normalizeProviderName(answers.provider);
      }

      if (answers.model) {
        model = answers.model.trim();
      }
    }
  }

  return {
    name,
    provider,
    model,
  };
}
