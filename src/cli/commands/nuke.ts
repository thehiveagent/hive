import * as fs from "node:fs";
import * as path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { exec } from "node:child_process";

import { Command } from "commander";
import keytar from "keytar";

import {
  getHiveHomeDir,
  getPrimaryAgent,
  openHiveDatabase,
  closeHiveDatabase,
} from "../../storage/db.js";
import { SUPPORTED_PROVIDER_NAMES } from "../../providers/base.js";
import { renderError, renderHiveHeader, renderInfo, renderSuccess } from "../ui.js";

const KEYCHAIN_SERVICE = "hive";
const NUKE_CONFIRMATION = "nuke";

export function registerNukeCommand(program: Command): void {
  program
    .command("nuke")
    .description("Permanently delete your local Hive data and keys")
    .action(async () => {
      await runNukeCommand();
    });
}

export async function runNukeCommand(): Promise<void> {
  renderHiveHeader("Nuke");
  renderError(
    "This will permanently delete your agent, all memory, all conversations, and all keys. This cannot be undone.",
  );

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  let confirmation = "";
  try {
    confirmation = (await rl.question('Are you sure? Type "nuke" to confirm: ')).trim();
  } finally {
    rl.close();
  }

  if (confirmation !== NUKE_CONFIRMATION) {
    renderInfo("Aborted.");
    return;
  }

  const homeDir = getHiveHomeDir();

  // Stop daemon and watcher if running
  renderInfo("Stopping daemon and watcher...");
  await stopDaemonBeforeNuke(homeDir);

  // Unregister system service
  await unregisterServiceBeforeNuke(homeDir);

  // Now wipe the directory
  fs.rmSync(homeDir, { recursive: true, force: true });

  for (const providerName of SUPPORTED_PROVIDER_NAMES) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, providerName);
    } catch {
      // Missing or inaccessible keychain entries are non-fatal for nuke.
    }
  }

  renderSuccess("The Hive has been nuked. Gone.");
}

/**
 * Stop the daemon before nuking
 */
async function stopDaemonBeforeNuke(homeDir: string): Promise<void> {
  const daemonPidFile = path.join(homeDir, "daemon.pid");
  const daemonStopSentinel = path.join(homeDir, "daemon.stop");
  const daemonPortFile = path.join(homeDir, "daemon.port");
  const defaultPort = 2718;

  try {
    // Check if daemon is running
    if (!fs.existsSync(daemonPidFile)) {
      return;
    }

    const pidContent = fs.readFileSync(daemonPidFile, "utf8").trim();
    const daemonPid = parseInt(pidContent, 10);
    if (isNaN(daemonPid)) {
      return;
    }

    // Check if process is running
    try {
      process.kill(daemonPid, 0);
    } catch {
      return; // Process not running
    }

    // Write stop sentinel first
    fs.writeFileSync(daemonStopSentinel, String(Date.now()));

    // Try to get port
    let port = defaultPort;
    try {
      const portContent = fs.readFileSync(daemonPortFile, "utf8").trim();
      port = parseInt(portContent, 10) || defaultPort;
    } catch {
      // Use default
    }

    // Send stop command via TCP
    try {
      await sendStopCommand(daemonPid, port);
    } catch {
      // May fail if daemon is unresponsive
    }

    // Wait for daemon to exit
    let waitTime = 0;
    const maxWait = 10000; // 10 seconds

    while (waitTime < maxWait) {
      try {
        process.kill(daemonPid, 0);
      } catch {
        break; // Process exited
      }
      await sleep(100);
      waitTime += 100;
    }

    // Force kill if still running
    try {
      process.kill(daemonPid, "SIGKILL");
    } catch {
      // Ignore
    }

    // Remove sentinel
    try {
      fs.unlinkSync(daemonStopSentinel);
    } catch {
      // Ignore
    }
  } catch {
    // Ignore errors during daemon stop
  }
}

/**
 * Send stop command to daemon via TCP
 */
function sendStopCommand(daemonPid: number, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const { createConnection } = require("node:net");
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "stop" }) + "\n");
    });

    let responded = false;

    socket.on("data", () => {
      if (!responded) {
        responded = true;
        socket.end();
        resolve();
      }
    });

    socket.on("error", () => {
      if (!responded) {
        socket.destroy();
        reject(new Error("TCP connection failed"));
      }
    });

    socket.setTimeout(3000, () => {
      if (!responded) {
        socket.destroy();
        reject(new Error("TCP timeout"));
      }
    });
  });
}

/**
 * Unregister system service before nuking
 */
async function unregisterServiceBeforeNuke(homeDir: string): Promise<void> {
  const platform = process.platform;
  const home = require("node:os").homedir();

  try {
    switch (platform) {
      case "darwin": {
        const serviceFile = path.join(
          home,
          "Library",
          "LaunchAgents",
          "net.thehiveagent.hive-watcher.plist",
        );
        if (fs.existsSync(serviceFile)) {
          try {
            await execAsync(`launchctl unload ${serviceFile}`);
          } catch {
            // Ignore
          }
          fs.unlinkSync(serviceFile);
        }
        break;
      }

      case "linux": {
        const serviceFile = path.join(home, ".config", "systemd", "user", "hive-watcher.service");
        if (fs.existsSync(serviceFile)) {
          try {
            await execAsync("systemctl --user stop hive-watcher.service");
            await execAsync("systemctl --user disable hive-watcher.service");
          } catch {
            // Ignore
          }
          fs.unlinkSync(serviceFile);
        }
        break;
      }

      case "win32": {
        try {
          await execAsync('schtasks /delete /tn "HiveWatcher" /f');
        } catch {
          // Ignore
        }
        break;
      }
    }
  } catch {
    // Ignore service unregistration errors
  }
}

/**
 * Simple sleep function
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
