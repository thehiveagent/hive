import * as fs from "node:fs";
import * as path from "node:path";
import { createConnection } from "node:net";
import { exec } from "node:child_process";
import { homedir } from "node:os";

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

import {
  getHiveHomeDir,
  getPrimaryAgent,
  openHiveDatabase,
  closeHiveDatabase,
  setMetaValue,
} from "../../storage/db.js";
import {
  renderHiveHeader,
  renderInfo,
  renderSeparator,
  renderStep,
  renderSuccess,
  renderError,
} from "../ui.js";

const HIVE_HOME = getHiveHomeDir();
const DAEMON_PID_FILE = path.join(HIVE_HOME, "daemon.pid");
const DAEMON_PORT_FILE = path.join(HIVE_HOME, "daemon.port");
const DAEMON_LOCK_FILE = path.join(HIVE_HOME, "daemon.lock");
const DAEMON_LOG_FILE = path.join(HIVE_HOME, "daemon.log");
const DAEMON_WATCHER_PID_FILE = path.join(HIVE_HOME, "daemon.watcher.pid");
const DAEMON_STOP_SENTINEL = path.join(HIVE_HOME, "daemon.stop");
const DAEMON_SERVICE_FILE_MAC = path.join(
  homedir(),
  "Library",
  "LaunchAgents",
  "net.thehiveagent.hive-watcher.plist",
);
const DAEMON_SERVICE_FILE_LINUX = path.join(
  homedir(),
  ".config",
  "systemd",
  "user",
  "hive-watcher.service",
);

const DEFAULT_PORT = 2718;
const TCP_TIMEOUT_MS = 3000;

// Import helper functions from other modules
import { installService, uninstallService, getServiceStatus } from "./daemon-service.js";

export function registerDaemonCommand(program: Command): void {
  const daemonCmd = program.command("daemon").description("Manage the Hive background daemon");

  daemonCmd
    .command("start")
    .description("Start the daemon and watcher services")
    .option("--force", "reinstall service even if already installed")
    .action(async (options) => {
      await runDaemonStartCommand(options);
    });

  daemonCmd
    .command("stop")
    .description("Stop the daemon and watcher services")
    .action(async () => {
      await runDaemonStopCommand();
    });

  daemonCmd
    .command("restart")
    .description("Restart the daemon")
    .action(async () => {
      await runDaemonRestartCommand();
    });

  daemonCmd
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      await runDaemonStatusCommand();
    });

  daemonCmd
    .command("logs")
    .description("Tail daemon logs")
    .option("-f, --follow", "follow logs in real-time")
    .option("-n, --lines <number>", "number of lines to show", "100")
    .action(async (options) => {
      await runDaemonLogsCommand(options);
    });
}

/**
 * Send a command to the daemon via TCP
 */
function sendDaemonCommand(
  command: Record<string, unknown>,
  port: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify(command) + "\n");
    });

    let buffer = "";
    let responded = false;

    socket.on("data", (data: Buffer) => {
      if (responded) return;

      buffer += data.toString();

      // Check for complete JSON object
      try {
        const response = JSON.parse(buffer);
        responded = true;
        socket.end();
        resolve(response);
      } catch {
        // Buffer not complete yet, wait for more data
      }
    });

    socket.on("error", (error) => {
      if (!responded) {
        responded = true;
        socket.destroy();
        reject(error);
      }
    });

    socket.setTimeout(TCP_TIMEOUT_MS, () => {
      if (!responded) {
        responded = true;
        socket.destroy();
        reject(new Error("TCP request timed out"));
      }
    });
  });
}

/**
 * Get daemon port (from file or default)
 */
function getDaemonPort(): number {
  try {
    const content = fs.readFileSync(DAEMON_PORT_FILE, "utf8").trim();
    return parseInt(content, 10) || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Check if daemon is running
 */
function isDaemonRunning(): { running: boolean; pid?: number; port?: number } {
  const pid = getDaemonPid();

  if (!pid) {
    return { running: false };
  }

  try {
    process.kill(pid, 0);
    const port = getDaemonPort();
    return { running: true, pid, port };
  } catch {
    return { running: false };
  }
}

/**
 * Check if watcher is running
 */
function isWatcherRunning(): { running: boolean; pid?: number } {
  try {
    const content = fs.readFileSync(DAEMON_WATCHER_PID_FILE, "utf8").trim();
    const pid = parseInt(content, 10);

    if (isNaN(pid)) {
      return { running: false };
    }

    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}

/**
 * Get daemon PID from file
 */
function getDaemonPid(): number | null {
  try {
    const content = fs.readFileSync(DAEMON_PID_FILE, "utf8").trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function runDaemonStartCommand(options: { force?: boolean } = {}): Promise<void> {
  renderHiveHeader("Daemon Start");

  const spinner = ora("Starting Hive daemon...").start();

  try {
    // Install service if needed
    const status = await getServiceStatus();
    if (!status.installed || options.force) {
      spinner.text = "Installing system service...";
      await installService();
      spinner.succeed("Service installed");
    } else {
      spinner.info("Service already installed");
    }

    // Start watcher (which will start daemon)
    spinner.text = "Starting watcher process...";
    const { spawn } = await import("node:child_process");
    const daemonScript = path.join(
      path.dirname(import.meta.dirname || import.meta.url),
      "dist",
      "daemon",
      "watcher.js",
    );

    const watcher = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HIVE_HOME,
      },
    });

    watcher.unref();

    // Give watcher time to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Wait for daemon to be ready
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (attempts < maxAttempts) {
      const status = isDaemonRunning();
      if (status.running) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (attempts < maxAttempts) {
      spinner.succeed(`Daemon running on port ${getDaemonPort()}`);
    } else {
      spinner.warn("Watcher started but daemon not responding yet");
    }

    // Show status
    await runDaemonStatusCommand();
  } catch (error) {
    spinner.fail("Failed to start daemon");
    renderError(String(error));
    throw error;
  }
}

export async function runDaemonStopCommand(): Promise<void> {
  renderHiveHeader("Daemon Stop");

  const spinner = ora("Stopping Hive daemon...").start();

  try {
    const status = isDaemonRunning();

    if (!status.running) {
      spinner.info("Daemon is not running");
    } else {
      // Write stop sentinel FIRST
      fs.writeFileSync(DAEMON_STOP_SENTINEL, String(Date.now()));
      spinner.text = "Sentinel file created";

      // Send stop command via TCP
      try {
        const port = getDaemonPort();
        await sendDaemonCommand({ type: "stop" }, port);
        spinner.text = "Stop command sent";
      } catch (error) {
        // May fail if daemon is already unresponsive
        spinner.info("TCP connection failed (daemon may be unresponsive)");
      }

      // Wait for daemon to exit
      let waitTime = 0;
      const maxWait = 10000; // 10 seconds

      while (waitTime < maxWait) {
        if (!isDaemonRunning().running) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        waitTime += 100;
      }

      // Force kill if still running
      if (isDaemonRunning().running) {
        try {
          process.kill(status.pid!, "SIGKILL");
        } catch {
          // Ignore
        }
      }

      // Remove sentinel file
      try {
        fs.unlinkSync(DAEMON_STOP_SENTINEL);
      } catch {
        // Ignore
      }

      spinner.succeed("Daemon stopped");
    }

    // Uninstall service
    spinner.text = "Uninstalling system service...";
    await uninstallService();
    spinner.succeed("Service uninstalled");
  } catch (error) {
    spinner.fail("Failed to stop daemon");
    renderError(String(error));
    throw error;
  }
}

export async function runDaemonRestartCommand(): Promise<void> {
  renderHiveHeader("Daemon Restart");

  const spinner = ora("Restarting Hive daemon...").start();

  try {
    // Stop first (with sentinel to prevent auto-restart)
    const status = isDaemonRunning();
    if (status.running) {
      fs.writeFileSync(DAEMON_STOP_SENTINEL, String(Date.now()));
    }

    // Kill daemon if still running
    if (status.running) {
      try {
        process.kill(status.pid!, "SIGKILL");
      } catch {
        // Ignore
      }
    }

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Remove sentinel
    try {
      fs.unlinkSync(DAEMON_STOP_SENTINEL);
    } catch {
      // Ignore
    }

    // Start fresh
    await runDaemonStartCommand();
    spinner.succeed("Daemon restarted");
  } catch (error) {
    spinner.fail("Failed to restart daemon");
    renderError(String(error));
    throw error;
  }
}

export async function runDaemonStatusCommand(): Promise<void> {
  renderHiveHeader("Daemon Status");

  const daemonStatus = isDaemonRunning();
  const watcherStatus = isWatcherRunning();

  // Get agent info from database
  let agentInfo: { name: string; provider: string; model: string } | null = null;
  let memoryStats: { episodes: number; conversations: number } | null = null;

  try {
    const db = openHiveDatabase();
    try {
      const agent = getPrimaryAgent(db);
      if (agent) {
        agentInfo = {
          name: agent.agent_name ?? "not set",
          provider: agent.provider,
          model: agent.model,
        };
      }

      const episodeCount = db.prepare("SELECT COUNT(*) as count FROM episodes").get() as {
        count: number;
      };
      const conversationCount = db.prepare("SELECT COUNT(*) as count FROM conversations").get() as {
        count: number;
      };
      memoryStats = {
        episodes: episodeCount.count,
        conversations: conversationCount.count,
      };
    } finally {
      closeHiveDatabase(db);
    }
  } catch {
    // Ignore database errors
  }

  // Try to get live status from daemon
  let daemonStatusFromDaemon: any = null;
  if (daemonStatus.running) {
    try {
      daemonStatusFromDaemon = await sendDaemonCommand({ type: "status" }, getDaemonPort());
    } catch {
      // Ignore
    }
  }

  // Daemon status line
  let statusColor: typeof chalk = chalk.green;
  let statusText = "running";
  if (!daemonStatus.running) {
    statusColor = chalk.red;
    statusText = "stopped";
  }

  // Heartbeat age
  let heartbeatAge: string | null = null;
  try {
    const lockContent = fs.readFileSync(DAEMON_LOCK_FILE, "utf8").trim();
    const lockTime = parseInt(lockContent, 10);
    if (!isNaN(lockTime)) {
      const age = Date.now() - lockTime;
      if (age < 60000) {
        heartbeatAge = `${Math.floor(age / 1000)}s ago`;
      } else {
        heartbeatAge = `${Math.floor(age / 60000)}m ${Math.floor((age % 60000) / 1000)}s ago`;
      }
    }
  } catch {
    heartbeatAge = "unknown";
  }

  // Log file size
  let logSize = "0 B";
  try {
    const stats = fs.statSync(DAEMON_LOG_FILE);
    logSize = formatBytes(stats.size);
  } catch {
    // Log file doesn't exist yet
  }

  // Watcher status
  let watcherText = "stopped";
  let watcherColor = chalk.red;
  if (watcherStatus.running) {
    watcherText = `running · PID ${watcherStatus.pid}`;
    watcherColor = chalk.green;
  }

  // Port
  const port = daemonStatusFromDaemon?.port || getDaemonPort();

  // Uptime
  let uptime = "n/a";
  if (daemonStatusFromDaemon) {
    uptime = daemonStatusFromDaemon.uptime || "n/a";
  }

  console.log("");
  console.log(chalk.gray("  ◆ Daemon Status"));
  console.log(chalk.gray("  " + "─".repeat(28)));
  console.log(`  ${chalk.dim("· Status     ")} ${statusColor(statusText)}`);
  console.log(`  ${chalk.dim("· PID        ")} ${daemonStatus.pid ?? chalk.dim("n/a")}`);
  console.log(`  ${chalk.dim("· Uptime     ")} ${chalk.white(uptime)}`);
  console.log(`  ${chalk.dim("· Agent      ")} ${agentInfo?.name ?? chalk.dim("not set")}`);
  console.log(
    `  ${chalk.dim("· Provider   ")} ${agentInfo?.provider ?? chalk.dim("none")} · ${agentInfo?.model ?? chalk.dim("none")}`,
  );
  console.log(`  ${chalk.dim("· Heartbeat  ")} ${heartbeatAge ?? chalk.dim("unknown")}`);
  console.log(`  ${chalk.dim("· Watcher    ")} ${watcherColor(watcherText)}`);
  console.log(
    `  ${chalk.dim("· Memory     ")} ${memoryStats ? `${memoryStats.episodes} episodes · ${memoryStats.conversations} conversations` : chalk.dim("n/a")}`,
  );
  console.log(`  ${chalk.dim("· Port       ")} ${chalk.white(`127.0.0.1:${port}`)}`);
  console.log(`  ${chalk.dim("· Log        ")} ${chalk.dim(`${DAEMON_LOG_FILE} (${logSize})`)}`);
  console.log("");
}

export async function runDaemonLogsCommand(
  options: { follow?: boolean; lines?: string } = {},
): Promise<void> {
  renderHiveHeader("Daemon Logs");

  const follow = options.follow ?? false;
  const lines = parseInt(options.lines ?? "100", 10);

  if (!fs.existsSync(DAEMON_LOG_FILE)) {
    renderInfo("No daemon logs found.");
    return;
  }

  if (follow) {
    // Tail -f
    console.log(`Tail ${DAEMON_LOG_FILE} (Ctrl+C to stop)...\n`);

    let pos = 0;
    const interval = setInterval(() => {
      try {
        const stats = fs.statSync(DAEMON_LOG_FILE);
        if (stats.size < pos) {
          pos = 0; // File rotated
        }

        const fd = fs.openSync(DAEMON_LOG_FILE, "r");
        const buffer = Buffer.alloc(Math.min(stats.size - pos, 4096));
        const read = fs.readSync(fd, buffer, 0, buffer.length, pos);
        fs.closeSync(fd);

        if (read > 0) {
          process.stdout.write(buffer.toString("utf8", 0, read));
          pos += read;
        }
      } catch {
        // Ignore errors
      }
    }, 500);

    process.on("SIGINT", () => {
      clearInterval(interval);
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      clearInterval(interval);
      process.exit(0);
    });
  } else {
    // Show last N lines
    const content = fs.readFileSync(DAEMON_LOG_FILE, "utf8");
    const linesArray = content.split("\n").filter((l) => l.length > 0);
    const start = Math.max(0, linesArray.length - lines);

    console.log(linesArray.slice(start).join("\n"));
  }
}

/**
 * Format bytes to human readable
 */
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
