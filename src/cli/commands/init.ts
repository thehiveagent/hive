import process from "node:process";
import * as fs from "node:fs";
import { join, dirname } from "node:path";
import { exec } from "node:child_process";

import { Command } from "commander";
import inquirer from "inquirer";
import keytar from "keytar";
import ora from "ora";

import { buildDefaultPersona } from "../../agent/agent.js";
import { promptForModel, promptForProvider } from "../helpers/providerPrompts.js";
import { renderHiveHeader, renderInfo, renderStep, renderSuccess } from "../ui.js";
import {
  closeHiveDatabase,
  getHiveHomeDir,
  getPrimaryAgent,
  openHiveDatabase,
  setMetaValue,
  type AgentRecord,
  upsertPrimaryAgent,
} from "../../storage/db.js";
import { initializeHiveCtxSession } from "../../agent/hive-ctx.js";
import type { ProviderName } from "../../providers/base.js";
import { createProviderWithKey, pingProvider } from "../../providers/index.js";
import { delay } from "../../providers/resilience.js";

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

    while (true) {
      const answers = await askInitQuestions();
      const confirmed = await confirmInitDetails(answers);
      if (!confirmed) {
        renderInfo("Restarting init...");
        continue;
      }

      const apiKey = await verifyApiKeyLoop(answers.provider, answers.model, answers.apiKey);

      spinner.start("Initializing...");

      if (answers.provider !== "ollama" && apiKey) {
        await keytar.setPassword(KEYCHAIN_SERVICE, answers.provider, apiKey);
      }

      const agent = upsertPrimaryAgent(db, {
        name: answers.name,
        provider: answers.provider,
        model: answers.model,
        persona: buildDefaultPersona(answers.name, answers.agentName ?? undefined),
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
      await warmupHiveCtx(agent);

      spinner.stop();
      await animateHiveId(agent.id);
      renderSuccess(`Agent name: ${agent.agent_name ?? "hive"}`);
      renderSuccess(`Provider: ${agent.provider}`);
      renderSuccess(`Model: ${agent.model}`);

      // Ask about starting daemon
      const { startDaemon } = (await inquirer.prompt([
        {
          type: "confirm",
          name: "startDaemon",
          message: "Start daemon on boot? (y/n)",
          default: true,
        },
      ])) as { startDaemon: boolean };

      if (startDaemon) {
        spinner.start("Starting daemon service...");
        try {
          await startDaemonService();
          spinner.succeed("Daemon service started");
        } catch (error) {
          spinner.fail("Failed to start daemon service");
          renderInfo(`Note: You can start the daemon manually with: hive daemon start`);
        }
      } else {
        renderStep("Run `hive daemon start` to start the background daemon");
      }

      renderStep("Run `hive` to start talking.");
      break;
    }
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Hive initialization failed.");
    }
    throw error;
  } finally {
    closeHiveDatabase(db);
  }
}

async function warmupHiveCtx(agent: AgentRecord): Promise<void> {
  const ctxStoragePath = join(getHiveHomeDir(), "ctx");
  fs.mkdirSync(ctxStoragePath, { recursive: true });

  const hiveCtx = await initializeHiveCtxSession({
    storagePath: ctxStoragePath,
    profile: agent,
    model: agent.model,
  });

  if (!hiveCtx.session) {
    return;
  }

  try {
    await hiveCtx.session.build("warmup");
  } catch {
    // ignore
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

async function confirmInitDetails(answers: InitAnswers): Promise<boolean> {
  console.log("");
  console.log("  ◆ Review your details");
  console.log("");
  console.log(`  Name:        ${answers.name}`);
  console.log(`  DOB:         ${answers.dob}`);
  console.log(`  Location:    ${answers.location}`);
  console.log(`  Profession:  ${answers.profession}`);
  console.log(`  Provider:    ${answers.provider}`);
  console.log(`  Model:       ${answers.model}`);
  console.log(`  Agent name:  ${answers.agentName ?? "hive"}`);
  console.log("");

  const { confirm } = (await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: "Confirm? (y/n)",
      default: true,
    },
  ])) as { confirm: boolean };

  return confirm;
}

async function verifyApiKeyLoop(
  provider: ProviderName,
  model: string,
  apiKey?: string,
): Promise<string | undefined> {
  if (provider === "ollama") {
    return undefined;
  }

  let currentKey = apiKey;

  while (true) {
    try {
      const probeProvider = await createProviderWithKey(provider, currentKey);
      await pingProvider(probeProvider, model);
      return currentKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify API key.";
      renderInfo(`API key check failed: ${message}`);
      const answer = (await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: "Re-enter your API key:",
          mask: "*",
          validate: requiredField("API key is required."),
        },
      ])) as { apiKey: string };
      currentKey = answer.apiKey.trim();
    }
  }
}

async function animateHiveId(id: string): Promise<void> {
  process.stdout.write("HIVE-ID: ");
  for (const char of id) {
    process.stdout.write(char);
    await delay(20);
  }
  process.stdout.write("\n");
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
      copiedCount += syncPromptFiles(sourceEntryPath, destinationEntryPath, overwriteExisting);
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

/**
 * Start the daemon service
 */
async function startDaemonService(): Promise<void> {
  const installationPath = getInstallationPath();
  const watcherPath = join(installationPath, "watcher.js");

  // Install service based on platform
  const platform = process.platform;
  const home = process.env.HOME || require("node:os").homedir();

  switch (platform) {
    case "darwin": {
      // macOS - Create LaunchAgent
      const serviceDir = join(home, "Library", "LaunchAgents");
      if (!fs.existsSync(serviceDir)) {
        fs.mkdirSync(serviceDir, { recursive: true });
      }

      const serviceFile = join(serviceDir, "net.thehiveagent.hive-watcher.plist");
      const plist = generateMacPlist(watcherPath);
      fs.writeFileSync(serviceFile, plist);

      // Load service
      await execAsync(`launchctl load ${serviceFile}`);
      break;
    }

    case "linux": {
      // Linux - Create systemd service
      const serviceDir = join(home, ".config", "systemd", "user");
      if (!fs.existsSync(serviceDir)) {
        fs.mkdirSync(serviceDir, { recursive: true });
      }

      const serviceFile = join(serviceDir, "hive-watcher.service");
      const serviceContent = generateLinuxService(watcherPath);
      fs.writeFileSync(serviceFile, serviceContent);

      // Enable and start service
      await execAsync("systemctl --user enable hive-watcher.service");
      await execAsync("systemctl --user start hive-watcher.service");
      break;
    }

    case "win32": {
      // Windows - Create Task Scheduler task
      const watcherPathEscaped = watcherPath.replace(/\\/g, "\\\\");
      const username = process.env.USERNAME || process.env.USER || "SYSTEM";

      const createTaskCmd = `schtasks /create /tn "HiveWatcher" /tr "node \\"${watcherPath}\\"" /sc onlogon /ru "${username}" /f`;
      await execAsync(createTaskCmd);
      break;
    }
  }
}

/**
 * Generate macOS LaunchAgent plist
 */
function generateMacPlist(watcherPath: string): string {
  const hiveHome = getHiveHomeDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>net.thehiveagent.hive-watcher</string>

    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>${watcherPath}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${hiveHome}/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>${hiveHome}/daemon.log</string>

    <key>WorkingDirectory</key>
    <string>${hiveHome}</string>
</dict>
</plist>`;
}

/**
 * Generate Linux systemd service file
 */
function generateLinuxService(watcherPath: string): string {
  const hiveHome = getHiveHomeDir();
  return `[Unit]
Description=Hive Agent Watcher
After=network.target

[Service]
Type=simple
ExecStart=node ${watcherPath}
Restart=always
RestartSec=5
WorkingDirectory=${hiveHome}
StandardOutput=file:${hiveHome}/daemon.log
StandardError=file:${hiveHome}/daemon.log

[Install]
WantedBy=default.target
`;
}

/**
 * Get installation path for daemon
 */
function getInstallationPath(): string {
  const modulePath = import.meta.url.replace("file://", "");
  return join(dirname(dirname(modulePath)), "daemon");
}

/**
 * Simple exec wrapper
 */
function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { exec } = require("node:child_process");
    exec(cmd, (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
