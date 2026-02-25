import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

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
const DEFAULT_PORT = 2718;
const TCP_TIMEOUT_MS = 500;

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
    printStatusLine("Daemon", await getDaemonStatusLine());
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

/**
 * Get daemon status line for status command
 */
async function getDaemonStatusLine(): Promise<string> {
  const daemonPidFile = join(getHiveHomeDir(), "daemon.pid");
  const daemonPortFile = join(getHiveHomeDir(), "daemon.port");
  const daemonLockFile = join(getHiveHomeDir(), "daemon.lock");
  const daemonWatcherPidFile = join(getHiveHomeDir(), "daemon.watcher.pid");

  // Check if watcher is running
  let watcherStatus = "stopped";
  try {
    const content = fs.readFileSync(daemonWatcherPidFile, "utf8").trim();
    const pid = parseInt(content, 10);
    if (!isNaN(pid)) {
      process.kill(pid, 0);
      watcherStatus = `watcher running (PID ${pid})`;
    }
  } catch {
    // Watcher not running
  }

  // Check if daemon is running
  let daemonStatus = "stopped";
  let uptime = "n/a";
  let daemonPort = DEFAULT_PORT;

  try {
    const content = fs.readFileSync(daemonPortFile, "utf8").trim();
    daemonPort = parseInt(content, 10) || DEFAULT_PORT;
  } catch {
    // Use default
  }

  try {
    const pidContent = fs.readFileSync(daemonPidFile, "utf8").trim();
    const pid = parseInt(pidContent, 10);
    if (!isNaN(pid)) {
      process.kill(pid, 0);

      // Get uptime from daemon
      try {
        const status = await getDaemonStatus(daemonPort);
        if (status && typeof status.uptime === "string") {
          uptime = status.uptime;
        }
        daemonStatus = `running (PID ${pid}, ${uptime})`;
      } catch {
        daemonStatus = `running (PID ${pid})`;
      }
    }
  } catch {
    // Daemon not running
  }

  // Heartbeat status
  let heartbeat = "unknown";
  try {
    const content = fs.readFileSync(daemonLockFile, "utf8").trim();
    const timestamp = parseInt(content, 10);
    if (!isNaN(timestamp)) {
      const age = Date.now() - timestamp;
      if (age < 60000) {
        heartbeat = `${Math.floor(age / 1000)}s ago`;
      } else {
        heartbeat = `${Math.floor(age / 60000)}m ago`;
      }
    }
  } catch {
    // No heartbeat file
  }

  return `${daemonStatus} | ${watcherStatus} | heartbeat: ${heartbeat}`;
}

/**
 * Get daemon status via TCP
 */
function getDaemonStatus(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "status" }) + "\n");
    });

    let buffer = "";
    let responded = false;

    socket.on("data", (data: Buffer) => {
      if (responded) return;

      buffer += data.toString();

      try {
        const response = JSON.parse(buffer);
        responded = true;
        socket.end();
        resolve(response);
      } catch {
        // Wait for more data
      }
    });

    socket.on("error", () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });

    socket.setTimeout(TCP_TIMEOUT_MS, () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });
  });
}
