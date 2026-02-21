import process from "node:process";
import * as fs from "node:fs";
import { join } from "node:path";

import { Command } from "commander";
import inquirer from "inquirer";
import keytar from "keytar";
import ora from "ora";

import { buildDefaultPersona } from "../../agent/agent.js";
import { promptForModel, promptForProvider } from "../helpers/providerPrompts.js";
import {
  renderHiveHeader,
  renderInfo,
  renderStep,
  renderSuccess,
} from "../ui.js";
import {
  closeHiveDatabase,
  getHiveHomeDir,
  getPrimaryAgent,
  openHiveDatabase,
  setMetaValue,
  upsertPrimaryAgent,
} from "../../storage/db.js";
import type { ProviderName } from "../../providers/base.js";

interface InitAnswers {
  name: string;
  dob: string;
  location: string;
  profession: string;
  aboutRaw: string;
  provider: ProviderName;
  model: string;
  apiKey?: string;
  agentName?: string;
}

interface InitCommandOptions {
  force?: boolean;
}

const KEYCHAIN_SERVICE = "hive";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Birth your local Hive agent")
    .option("--force", "overwrite ~/.hive/prompts when loading prompts")
    .action(async (options: InitCommandOptions) => {
      await runInitCommand(options);
    });
}

export async function runInitCommand(options: InitCommandOptions = {}): Promise<void> {
  renderHiveHeader("Init");
  const spinner = ora("Preparing init...").start();
  const db = openHiveDatabase();

  try {
    if (!process.stdin.isTTY) {
      throw new Error("`hive init` requires an interactive terminal.");
    }

    const existing = getPrimaryAgent(db);
    spinner.stop();

    if (existing) {
      const { reinitialize } = (await inquirer.prompt([
        {
          type: "confirm",
          name: "reinitialize",
          message: "Agent already exists. Reinitialize? (y/n)",
          default: false,
        },
      ])) as { reinitialize: boolean };

      if (!reinitialize) {
        renderInfo("Initialization cancelled.");
        return;
      }
    }

    const answers = await askInitQuestions();
    spinner.start("Initializing...");

    if (answers.provider !== "ollama" && answers.apiKey) {
      await keytar.setPassword(KEYCHAIN_SERVICE, answers.provider, answers.apiKey);
    }

    const agent = upsertPrimaryAgent(db, {
      name: answers.name,
      provider: answers.provider,
      model: answers.model,
      persona: buildDefaultPersona(answers.name),
      dob: answers.dob,
      location: answers.location,
      profession: answers.profession,
      aboutRaw: answers.aboutRaw,
      agentName: answers.agentName ?? null,
    });

    setMetaValue(db, "initialized_at", new Date().toISOString());
    setMetaValue(db, "provider", agent.provider);
    setMetaValue(db, "model", agent.model);
    copyPromptsDirectory(options.force ?? false);

    spinner.succeed("Initialization complete.");
    renderSuccess(`HIVE-ID: ${agent.id}`);
    if (agent.agent_name) {
      renderSuccess(`Agent name: ${agent.agent_name}`);
    }
    renderSuccess(`Provider: ${agent.provider}`);
    renderSuccess(`Model: ${agent.model}`);
    renderStep("Run `hive` to start talking.");
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Hive initialization failed.");
    }
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

async function askInitQuestions(): Promise<InitAnswers> {
  const { name } = (await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "What's your name?",
      validate: requiredField("Name is required."),
    },
  ])) as { name: string };

  const { dob } = (await inquirer.prompt([
    {
      type: "input",
      name: "dob",
      message: "Date of birth? (DD/MM/YYYY)",
      validate: (value: string) =>
        /^\d{2}\/\d{2}\/\d{4}$/.test(value.trim()) || "Use DD/MM/YYYY format.",
    },
  ])) as { dob: string };

  const { location } = (await inquirer.prompt([
    {
      type: "input",
      name: "location",
      message: "Where are you based?",
      validate: requiredField("Location is required."),
    },
  ])) as { location: string };

  const { profession } = (await inquirer.prompt([
    {
      type: "input",
      name: "profession",
      message: "What do you do?",
      validate: requiredField("Profession is required."),
    },
  ])) as { profession: string };

  const { aboutRaw } = (await inquirer.prompt([
    {
      type: "input",
      name: "aboutRaw",
      message:
        "Tell me about yourself. Who you are, what you're building, what matters to you. No rules.",
      validate: requiredField("About is required."),
    },
  ])) as { aboutRaw: string };

  const provider = await promptForProvider();
  const model = await promptForModel(provider);

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

  const { agentName } = (await inquirer.prompt([
    {
      type: "input",
      name: "agentName",
      message: "What do you want to call your agent? (optional)",
    },
  ])) as { agentName: string };

  return {
    name: name.trim(),
    dob: dob.trim(),
    location: location.trim(),
    profession: profession.trim(),
    aboutRaw,
    provider,
    model,
    apiKey,
    agentName: normalizeOptional(agentName),
  };
}

function requiredField(message: string): (value: string) => true | string {
  return (value: string) => {
    if (value.trim().length > 0) {
      return true;
    }

    return message;
  };
}

function normalizeOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function copyPromptsDirectory(force: boolean): void {
  const sourcePath = join(process.cwd(), "prompts");
  const destinationPath = join(getHiveHomeDir(), "prompts");

  if (!fs.existsSync(sourcePath)) {
    renderInfo("Warning: prompts/ folder not found. Skipping prompts load.");
    return;
  }

  if (force && fs.existsSync(destinationPath)) {
    fs.rmSync(destinationPath, { recursive: true, force: true });
  }

  fs.mkdirSync(destinationPath, { recursive: true });
  const copiedFiles = syncPromptFiles(sourcePath, destinationPath, force);

  if (copiedFiles === 0) {
    renderStep("Prompts already up to date -> ~/.hive/prompts/");
    return;
  }

  renderStep(`Prompts loaded -> ~/.hive/prompts/ (${copiedFiles} files)`);
}

function syncPromptFiles(
  sourceDirectory: string,
  destinationDirectory: string,
  overwriteExisting: boolean,
): number {
  let copiedCount = 0;
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourceEntryPath = join(sourceDirectory, entry.name);
    const destinationEntryPath = join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destinationEntryPath, { recursive: true });
      copiedCount += syncPromptFiles(
        sourceEntryPath,
        destinationEntryPath,
        overwriteExisting,
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!overwriteExisting && fs.existsSync(destinationEntryPath)) {
      continue;
    }

    fs.copyFileSync(sourceEntryPath, destinationEntryPath);
    copiedCount += 1;
  }

  return copiedCount;
}
