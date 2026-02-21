import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { Command } from "commander";
import keytar from "keytar";
import {
  renderHiveHeader,
  renderInfo,
  renderSeparator,
  renderStep,
} from "../ui.js";

import {
  closeHiveDatabase,
  getHiveDatabasePath,
  getHiveHomeDir,
  getMetaValue,
  getPrimaryAgent,
  openHiveDatabase,
} from "../../storage/db.js";

const KEYCHAIN_SERVICE = "hive";
const PROMPTS_DIRECTORY = "prompts";

interface StatusCommandRenderOptions {
  showHeader?: boolean;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show Hive setup status")
    .action(async () => {
      await runStatusCommand();
    });
}

export async function runStatusCommand(): Promise<void> {
  await runStatusCommandWithOptions();
}

export async function runStatusCommandWithOptions(
  options: StatusCommandRenderOptions = {},
): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Status");
  }

  const db = openHiveDatabase();

  try {
    const agent = getPrimaryAgent(db);
    if (!agent) {
      renderInfo("Hive is not initialized. Run `hive init` to get started.");
      return;
    }

    const provider = agent.provider;
    const keyStatus = await getApiKeyStatus(provider);
    const dbPath = getHiveDatabasePath();
    const promptsPath = join(getHiveHomeDir(), PROMPTS_DIRECTORY);
    const dbSizeBytes = getFileSize(dbPath);
    const promptFiles = countFiles(promptsPath);
    const initializedRaw = getMetaValue(db, "initialized_at") ?? agent.created_at;

    if (showHeader) {
      renderStep("Status");
    }
    renderSeparator();
    printStatusLine("Agent", agent.agent_name ?? "not set");
    printStatusLine("Owner", agent.name);
    printStatusLine("Provider", provider);
    printStatusLine("Model", agent.model);
    printStatusLine("API Key", keyStatus);
    renderSeparator();
    printStatusLine(
      "Database",
      `${displayPath(dbPath)} (${formatBytes(dbSizeBytes)})`,
    );
    printStatusLine(
      "Prompts",
      `${ensureTrailingSlash(displayPath(promptsPath))} (${promptFiles} files)`,
    );
    renderSeparator();
    printStatusLine("Initialized", formatDate(initializedRaw));
  } finally {
    closeHiveDatabase(db);
  }
}

async function getApiKeyStatus(providerName: string): Promise<string> {
  let key: string | null = null;

  try {
    key = await keytar.getPassword(KEYCHAIN_SERVICE, providerName);
  } catch {
    key = null;
  }

  return key && key.trim().length > 0 ? "set ✓" : "not set ✗";
}

function printStatusLine(label: string, value: string): void {
  const paddedLabel = `${label}:`.padEnd(10, " ");
  console.log(`${chalk.dim(paddedLabel)} ${value}`);
}

function getFileSize(path: string): number {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

function countFiles(path: string): number {
  try {
    return fs
      .readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function displayPath(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }

  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }

  return path;
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}
