#!/usr/bin/env node
/**
 * Hive Watcher - Auto-restarts daemon on crash
 *
 * Behavior:
 * - Checks daemon heartbeat file every 60 seconds
 * - If lock file is stale (> 90 seconds), respawn daemon
 * - Respects daemon.stop sentinel file
 * - Registered as system service, not daemon directly
 */

import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { getHiveHomeDir } from "../storage/db.js";

const HIVE_HOME = getHiveHomeDir();
const DAEMON_PID_FILE = path.join(HIVE_HOME, "daemon.pid");
const DAEMON_PORT_FILE = path.join(HIVE_HOME, "daemon.port");
const DAEMON_LOCK_FILE = path.join(HIVE_HOME, "daemon.lock");
const DAEMON_LOG_FILE = path.join(HIVE_HOME, "daemon.log");
const DAEMON_STOP_SENTINEL = path.join(HIVE_HOME, "daemon.stop");
const DAEMON_WATCHER_PID_FILE = path.join(HIVE_HOME, "daemon.watcher.pid");

const WATCHER_CHECK_INTERVAL_MS = 60000; // 60 seconds
const STALE_THRESHOLD_MS = 90000; // 90 seconds

// Watcher state
let daemonProcess: any = null;
let watcherInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;

/**
 * Log to file
 */
function logToDaemonFile(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [WATCHER] ${message}\n`;

  try {
    fs.appendFileSync(DAEMON_LOG_FILE, logLine);
  } catch {
    // Fallback to console if file logging fails
    console.error(logLine.trim());
  }
}

/**
 * Write watcher PID file
 */
function writeWatcherPidFile(): void {
  fs.writeFileSync(DAEMON_WATCHER_PID_FILE, String(process.pid));
}

/**
 * Remove watcher PID file
 */
function removeWatcherPidFile(): void {
  try {
    fs.unlinkSync(DAEMON_WATCHER_PID_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Get current lock file timestamp
 */
function getLockTimestamp(): number | null {
  try {
    const content = fs.readFileSync(DAEMON_LOCK_FILE, "utf8").trim();
    const timestamp = parseInt(content, 10);
    if (isNaN(timestamp)) {
      return null;
    }
    return timestamp;
  } catch {
    return null;
  }
}

/**
 * Get daemon PID
 */
function getDaemonPid(): number | null {
  try {
    const content = fs.readFileSync(DAEMON_PID_FILE, "utf8").trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid)) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process gracefully
 */
function killProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already dead
      }
    }, 5000);
  } catch {
    // Process already dead
  }
}

/**
 * Spawn a new daemon process
 */
function spawnDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    logToDaemonFile("Spawning new daemon process...");

    const daemonScript = path.join(import.meta.dirname || import.meta.url, "..", "daemon", "index.js");

    daemonProcess = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HIVE_HOME,
      },
    });

    // Forward daemon output to log file
    if (daemonProcess.stdout) {
      daemonProcess.stdout.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          logToDaemonFile(`[DAEMON STDOUT] ${text}`);
        }
      });
    }

    if (daemonProcess.stderr) {
      daemonProcess.stderr.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          logToDaemonFile(`[DAEMON STDERR] ${text}`);
        }
      });
    }

    daemonProcess.on("error", (error: Error) => {
      logToDaemonFile(`Failed to spawn daemon: ${error.message}`);
      reject(error);
    });

    daemonProcess.on("exit", (code: number | null) => {
      if (code !== null && code !== 0) {
        logToDaemonFile(`Daemon exited with code ${code}`);
      }
    });

    // Resolve immediately - daemon runs independently
    logToDaemonFile("Daemon spawned successfully");
    resolve();
  });
}

/**
 * Start the daemon if not running
 */
async function ensureDaemonRunning(): Promise<void> {
  // Check for stop sentinel
  if (fs.existsSync(DAEMON_STOP_SENTINEL)) {
    logToDaemonFile("Stop sentinel found. Not starting daemon.");
    return;
  }

  const daemonPid = getDaemonPid();

  if (daemonPid && isProcessRunning(daemonPid)) {
    // Daemon is running, check heartbeat
    const lockTime = getLockTimestamp();

    if (lockTime === null) {
      logToDaemonFile("Lock file missing or invalid. Restarting daemon...");
      killProcess(daemonPid);
      await spawnDaemon();
      return;
    }

    const now = Date.now();
    const age = now - lockTime;

    if (age > STALE_THRESHOLD_MS) {
      logToDaemonFile(`Heartbeat stale (${Math.floor(age / 1000)}s). Restarting daemon...`);
      killProcess(daemonPid);
      await spawnDaemon();
      return;
    }

    logToDaemonFile(`Daemon running (heartbeat: ${Math.floor(age / 1000)}s ago)`);
    return;
  }

  // Daemon not running, start it
  logToDaemonFile("Daemon not running. Starting...");
  await spawnDaemon();
}

/**
 * Cleanup and exit
 */
async function cleanupAndExit(): Promise<void> {
  isShuttingDown = true;
  logToDaemonFile("Watcher shutting down...");

  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }

  if (daemonProcess && daemonProcess.pid) {
    logToDaemonFile("Stopping daemon...");
    killProcess(daemonProcess.pid);
  }

  removeWatcherPidFile();
  logToDaemonFile("Watcher stopped");
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logToDaemonFile("Hive Watcher starting...");

  // Write watcher PID
  writeWatcherPidFile();

  // Initial daemon start
  await ensureDaemonRunning();

  // Start checking loop
  watcherInterval = setInterval(async () => {
    try {
      await ensureDaemonRunning();
    } catch (error) {
      logToDaemonFile(`Error checking daemon: ${(error as Error).message}`);
    }
  }, WATCHER_CHECK_INTERVAL_MS);

  logToDaemonFile("Watcher is running");

  // Handle signals
  process.on("SIGTERM", cleanupAndExit);
  process.on("SIGINT", cleanupAndExit);

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logToDaemonFile(`Uncaught error: ${error.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    logToDaemonFile(`Unhandled rejection: ${reason}`);
  });
}

main().catch((error) => {
  logToDaemonFile(`Fatal error: ${error.message}`);
  process.exit(1);
});
