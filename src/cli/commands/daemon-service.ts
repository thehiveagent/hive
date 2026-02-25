import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getHiveHomeDir } from "../../storage/db.js";
import { renderInfo, renderSuccess, renderError } from "../ui.js";

const HIVE_HOME = getHiveHomeDir();
const SERVICE_DIR_MAC = path.join(homedir(), "Library", "LaunchAgents");
const SERVICE_DIR_LINUX = path.join(homedir(), ".config", "systemd", "user");
const SERVICE_NAME_MAC = "net.thehiveagent.hive-watcher.plist";
const SERVICE_NAME_LINUX = "hive-watcher.service";
const SERVICE_NAME_WINDOWS = "HiveWatcher";

const SERVICE_FILE_MAC = path.join(SERVICE_DIR_MAC, SERVICE_NAME_MAC);
const SERVICE_FILE_LINUX = path.join(SERVICE_DIR_LINUX, SERVICE_NAME_LINUX);

/**
 * Get the installation path for the daemon
 */
function getInstallationPath(): string {
  // Resolve relative to compiled CLI location:
  // dist/cli/commands/daemon-service.js -> package root -> dist/daemon
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const packageRoot = path.resolve(thisDir, "..", "..", "..");
  return path.join(packageRoot, "dist", "daemon");
}

/**
 * Get the full path to the watcher script
 */
function getWatcherPath(): string {
  const installationPath = getInstallationPath();
  const watcherPath = path.join(installationPath, "watcher.js");
  return watcherPath;
}

export async function startService(): Promise<void> {
  const platform = process.platform;

  switch (platform) {
    case "darwin": {
      await execAsync("launchctl start net.thehiveagent.hive-watcher");
      return;
    }
    case "linux": {
      await execAsync("systemctl --user start hive-watcher");
      return;
    }
    case "win32": {
      await execAsync('schtasks /run /tn "HiveWatcher"');
      return;
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Generate macOS LaunchAgent plist
 */
function generateMacPlist(): string {
  const watcherPath = getWatcherPath();
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
    <string>${HIVE_HOME}/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>${HIVE_HOME}/daemon.log</string>

    <key>WorkingDirectory</key>
    <string>${HIVE_HOME}</string>
</dict>
</plist>`;
}

/**
 * Generate Linux systemd service file
 */
function generateLinuxService(): string {
  const watcherPath = getWatcherPath();
  return `[Unit]
Description=Hive Agent Watcher
After=network.target

[Service]
Type=simple
ExecStart=node ${watcherPath}
Restart=always
RestartSec=5
WorkingDirectory=${HIVE_HOME}
StandardOutput=file:${HIVE_HOME}/daemon.log
StandardError=file:${HIVE_HOME}/daemon.log

[Install]
WantedBy=default.target
`;
}

/**
 * Check if service is installed on macOS
 */
function isServiceInstalledMac(): boolean {
  return fs.existsSync(SERVICE_FILE_MAC);
}

/**
 * Check if service is installed on Linux
 */
function isServiceInstalledLinux(): boolean {
  return fs.existsSync(SERVICE_FILE_LINUX);
}

/**
 * Check if service is running on Linux
 */
function isServiceRunningLinux(): boolean {
  try {
    const { execSync } = require("node:child_process");
    execSync("systemctl --user is-active hive-watcher.service", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install service for current platform
 */
export async function installService(): Promise<void> {
  const platform = process.platform;

  switch (platform) {
    case "darwin": {
      // macOS
      if (!fs.existsSync(SERVICE_DIR_MAC)) {
        fs.mkdirSync(SERVICE_DIR_MAC, { recursive: true });
      }

      const plist = generateMacPlist();
      fs.writeFileSync(SERVICE_FILE_MAC, plist);

      try {
        await execAsync(`launchctl load ${SERVICE_FILE_MAC}`);
      } catch {
        // Already loaded or permission issue
      }

      // Explicitly start right away (don't wait for reboot/login)
      try {
        await startService();
      } catch {
        // Best-effort
      }

      renderSuccess(`Service installed: ${SERVICE_FILE_MAC}`);
      break;
    }

    case "linux": {
      // Linux
      if (!fs.existsSync(SERVICE_DIR_LINUX)) {
        fs.mkdirSync(SERVICE_DIR_LINUX, { recursive: true });
      }

      const serviceContent = generateLinuxService();
      fs.writeFileSync(SERVICE_FILE_LINUX, serviceContent);

      try {
        await execAsync("systemctl --user daemon-reload");
        await execAsync("systemctl --user enable hive-watcher");
        await startService();
      } catch (error) {
        renderInfo("Note: systemctl may require passwordless sudo for user services");
        throw error;
      }

      renderSuccess(`Service installed: ${SERVICE_FILE_LINUX}`);
      break;
    }

    case "win32": {
      // Windows - Use Task Scheduler
      const watcherPath = getWatcherPath().replace(/\\/g, "\\\\");
      const username = process.env.USERNAME || process.env.USER || "SYSTEM";

      const createTaskCmd = `schtasks /create /tn "HiveWatcher" /tr "node \\"${watcherPath}\\"" /sc onlogon /ru "${username}" /f`;
      try {
        await execAsync(createTaskCmd);
        // Explicitly start right away
        try {
          await startService();
        } catch {
          // Best-effort
        }
        renderSuccess("Windows Task Scheduler task created");
      } catch (error) {
        renderError("Failed to create Windows Task Scheduler task");
        throw error;
      }
      break;
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Uninstall service for current platform
 */
export async function uninstallService(): Promise<void> {
  const platform = process.platform;

  switch (platform) {
    case "darwin": {
      // macOS
      try {
        await execAsync(`launchctl unload ${SERVICE_FILE_MAC}`);
      } catch {
        // Already unloaded or not found
      }

      if (fs.existsSync(SERVICE_FILE_MAC)) {
        fs.unlinkSync(SERVICE_FILE_MAC);
      }

      renderInfo("Service uninstalled (macOS)");
      break;
    }

    case "linux": {
      // Linux
      try {
        await execAsync("systemctl --user stop hive-watcher");
        await execAsync("systemctl --user disable hive-watcher");
      } catch {
        // Already stopped or not found
      }

      if (fs.existsSync(SERVICE_FILE_LINUX)) {
        fs.unlinkSync(SERVICE_FILE_LINUX);
      }

      renderInfo("Service uninstalled (Linux)");
      break;
    }

    case "win32": {
      // Windows
      try {
        await execAsync('schtasks /delete /tn "HiveWatcher" /f');
        renderInfo("Windows Task Scheduler task deleted");
      } catch {
        // Not found
      }
      break;
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get service status for current platform
 */
export async function getServiceStatus(): Promise<{
  installed: boolean;
  running: boolean;
  platform: string;
}> {
  const platform = process.platform;
  let installed = false;
  let running = false;

  switch (platform) {
    case "darwin": {
      installed = fs.existsSync(SERVICE_FILE_MAC);
      try {
        const { execSync } = require("node:child_process");
        execSync("launchctl list | grep hive-watcher", { stdio: "ignore" });
        running = true;
      } catch {
        // Not running
      }
      break;
    }

    case "linux": {
      installed = fs.existsSync(SERVICE_FILE_LINUX);
      running = isServiceRunningLinux();
      break;
    }

    case "win32": {
      // Windows
      try {
        const { execSync } = require("node:child_process");
        execSync('schtasks /query /tn "HiveWatcher" /fo CSV', { stdio: "ignore" });
        installed = true;
        running = true;
      } catch {
        // Not found
      }
      break;
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  return { installed, running, platform };
}

/**
 * Simple exec wrapper with Promise
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
