#!/usr/bin/env node
/**
 * Hive Daemon - Always-on background process for The Hive
 *
 * Features:
 * - TCP server on port 2718 for IPC
 * - Auto-restart on crash via watcher
 * - Heartbeat mechanism for health monitoring
 * - Graceful shutdown protocol
 * - Cross-platform service registration
 */

import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { createServer, type Socket } from "node:net";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getHiveHomeDir, getPrimaryAgent, openHiveDatabase, closeHiveDatabase } from "../storage/db.js";
import { initializeHiveCtxSession } from "../agent/hive-ctx.js";
import type { Provider } from "../providers/base.js";
import { createProvider } from "../providers/index.js";

const execAsync = promisify(exec);

const PORT = 2718;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const WATCHER_CHECK_INTERVAL_MS = 60000; // 60 seconds
const STALE_THRESHOLD_MS = 90000; // 90 seconds
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_MAX_FILES = 3;

const HIVE_HOME = getHiveHomeDir();
const DAEMON_PID_FILE = path.join(HIVE_HOME, "daemon.pid");
const DAEMON_PORT_FILE = path.join(HIVE_HOME, "daemon.port");
const DAEMON_LOCK_FILE = path.join(HIVE_HOME, "daemon.lock");
const DAEMON_LOG_FILE = path.join(HIVE_HOME, "daemon.log");
const DAEMON_STOP_SENTINEL = path.join(HIVE_HOME, "daemon.stop");
const DAEMON_CTX_PATH = path.join(HIVE_HOME, "ctx");

// Log rotation state
let currentLogSize = 0;
let logBuffer = "";

// Daemon state
let startTime: number;
let db: any = null;
let provider: Provider | null = null;
let agent: any = null;
let ctxSession: any = null;
let tcpServer: any = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Log to file with rotation
 */
function logToDaemonFile(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  // Check if rotation is needed
  try {
    const stats = fs.statSync(DAEMON_LOG_FILE);
    if (stats.size >= LOG_MAX_SIZE) {
      rotateLogs();
    }
  } catch {
    // File doesn't exist yet
  }

  fs.appendFileSync(DAEMON_LOG_FILE, logLine);
}

/**
 * Rotate log files
 */
function rotateLogs(): void {
  for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
    const src = `${DAEMON_LOG_FILE}.${i}`;
    const dest = `${DAEMON_LOG_FILE}.${i + 1}`;
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
      }
    } catch {
      // Ignore rotation errors
    }
  }

  // Move current log to .1
  try {
    if (fs.existsSync(DAEMON_LOG_FILE)) {
      fs.renameSync(DAEMON_LOG_FILE, `${DAEMON_LOG_FILE}.1`);
    }
  } catch {
    // Ignore rotation errors
  }

  // Create new empty log file
  fs.writeFileSync(DAEMON_LOG_FILE, "");
}

/**
 * Write PID file
 */
function writePidFile(): void {
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
}

/**
 * Write port file
 */
function writePortFile(port: number): void {
  fs.writeFileSync(DAEMON_PORT_FILE, String(port));
}

/**
 * Remove PID file
 */
function removePidFile(): void {
  try {
    fs.unlinkSync(DAEMON_PID_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Update heartbeat lock file
 */
function updateHeartbeat(): void {
  fs.writeFileSync(DAEMON_LOCK_FILE, String(Date.now()));
}

/**
 * Initialize the daemon
 */
async function initializeDaemon(): Promise<void> {
  logToDaemonFile("Initializing Hive daemon...");

  // Create hive home directory if needed
  if (!fs.existsSync(HIVE_HOME)) {
    fs.mkdirSync(HIVE_HOME, { recursive: true });
  }

  // Create ctx directory
  if (!fs.existsSync(DAEMON_CTX_PATH)) {
    fs.mkdirSync(DAEMON_CTX_PATH, { recursive: true });
  }

  // Open database
  logToDaemonFile("Opening database...");
  db = openHiveDatabase();

  // Load agent profile
  logToDaemonFile("Loading agent profile...");
  agent = getPrimaryAgent(db);
  if (!agent) {
    logToDaemonFile("Warning: No agent profile found. Daemon will start but agent features unavailable.");
  }

  // Initialize provider
  if (agent) {
    try {
      logToDaemonFile(`Initializing provider: ${agent.provider}...`);
      provider = await createProvider(agent.provider);
    } catch (error) {
      logToDaemonFile(`Warning: Failed to initialize provider: ${error}`);
    }
  }

  // Initialize hive-ctx
  if (agent) {
    try {
      logToDaemonFile("Initializing hive-ctx...");
      const result = await initializeHiveCtxSession({
        storagePath: DAEMON_CTX_PATH,
        profile: agent,
        model: agent.model,
      });
      ctxSession = result.session;
      if (result.warning) {
        logToDaemonFile(result.warning);
      }
    } catch (error) {
      logToDaemonFile(`Warning: Failed to initialize hive-ctx: ${error}`);
    }
  }

  // Write PID file
  writePidFile();
  logToDaemonFile(`PID file written: ${process.pid}`);

  // Update heartbeat
  updateHeartbeat();
  logToDaemonFile("Heartbeat started");

  // Start heartbeat interval
  heartbeatInterval = setInterval(() => {
    // Check for stop sentinel
    if (fs.existsSync(DAEMON_STOP_SENTINEL)) {
      logToDaemonFile("Stop sentinel detected. Shutting down...");
      cleanupAndExit(0);
      return;
    }

    updateHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logToDaemonFile("Daemon initialization complete");
}

/**
 * Handle TCP connection
 */
function handleConnection(socket: Socket): void {
  let buffer = "";

  socket.on("data", (data: Buffer) => {
    buffer += data.toString();

    // Process complete lines
    while (buffer.includes("\n")) {
      const lineEnd = buffer.indexOf("\n");
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);

      if (line.length === 0) continue;

      handleCommand(line, socket);
    }
  });

  socket.on("error", (error) => {
    logToDaemonFile(`TCP connection error: ${error.message}`);
  });

  socket.on("close", () => {
    logToDaemonFile("TCP connection closed");
  });
}

/**
 * Handle IPC command
 */
function handleCommand(command: string, socket: Socket): void {
  try {
    const parsed = JSON.parse(command);

    if (!parsed || typeof parsed !== "object") {
      sendResponse(socket, { error: "Invalid JSON object" });
      return;
    }

    switch (parsed.type) {
      case "status":
        handleStatus(socket);
        break;
      case "ping":
        handlePing(socket);
        break;
      case "stop":
        handleStop(socket);
        break;
      case "task":
        handleTask(parsed, socket);
        break;
      default:
        sendResponse(socket, { error: `Unknown command type: ${parsed.type}` });
    }
  } catch (error) {
    sendResponse(socket, { error: "Invalid JSON" });
  }
}

/**
 * Handle status command
 */
function handleStatus(socket: Socket): void {
  const now = Date.now();
  const uptime = Math.floor((now - startTime) / 1000);
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);

  let memoryStats = { episodes: 0, conversations: 0 };

  if (db) {
    try {
      const episodeCount = db.prepare("SELECT COUNT(*) as count FROM episodes").get() as { count: number };
      const conversationCount = db.prepare("SELECT COUNT(*) as count FROM conversations").get() as { count: number };
      memoryStats = {
        episodes: episodeCount.count,
        conversations: conversationCount.count,
      };
    } catch {
      // Ignore database errors
    }
  }

  const response = {
    pid: process.pid,
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    uptimeSeconds: uptime,
    agent: agent?.agent_name ?? "not set",
    provider: agent?.provider ?? "none",
    model: agent?.model ?? "none",
    memoryStats,
    ctxEnabled: !!ctxSession,
    timestamp: now,
  };

  sendResponse(socket, response);
}

/**
 * Handle ping command
 */
function handlePing(socket: Socket): void {
  sendResponse(socket, {
    pong: true,
    timestamp: Date.now(),
  });
}

/**
 * Handle stop command
 */
function handleStop(socket: Socket): void {
  sendResponse(socket, { acknowledged: true });

  // Remove sentinel and exit cleanly
  try {
    fs.unlinkSync(DAEMON_STOP_SENTINEL);
  } catch {
    // Ignore
  }

  setTimeout(() => {
    cleanupAndExit(0);
  }, 100);
}

/**
 * Handle task command (stub for v0.2)
 */
function handleTask(parsed: any, socket: Socket): void {
  sendResponse(socket, {
    accepted: true,
    taskId: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });
}

/**
 * Send response to socket
 */
function sendResponse(socket: Socket, data: Record<string, unknown>): void {
  try {
    const response = JSON.stringify(data) + "\n";
    socket.write(response);
  } catch {
    // Ignore write errors
  }
}

/**
 * Start TCP server
 */
async function startTcpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    tcpServer = createServer(handleConnection);

    tcpServer.on("error", (error: Error) => {
      logToDaemonFile(`TCP server error: ${error.message}`);
      reject(error);
    });

    // Try to bind to port 2718, increment if needed
    let currentPort = PORT;

    const bindNextPort = () => {
      tcpServer.listen(currentPort, "127.0.0.1", () => {
        writePortFile(currentPort);
        logToDaemonFile(`TCP server listening on 127.0.0.1:${currentPort}`);
        resolve();
      });
    };

    tcpServer.on("listening", () => {
      // Port is already written in the callback above
    });

    tcpServer.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        logToDaemonFile(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
        currentPort += 1;
        tcpServer.close();
        bindNextPort();
      } else {
        reject(error);
      }
    });

    bindNextPort();
  });
}

/**
 * Cleanup and exit
 */
async function cleanupAndExit(code: number): Promise<void> {
  logToDaemonFile(`Cleaning up and exiting with code ${code}`);

  // Clear heartbeat interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Close TCP server
  if (tcpServer) {
    tcpServer.close(() => {
      logToDaemonFile("TCP server closed");
    });
  }

  // Remove PID file
  removePidFile();

  // Close database
  if (db) {
    closeHiveDatabase(db);
    db = null;
  }

  process.exit(code);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Start time for uptime calculation
  startTime = Date.now();

  // Initialize daemon
  await initializeDaemon();

  // Start TCP server
  await startTcpServer();

  logToDaemonFile("Daemon is running. Press Ctrl+C to stop.");

  // Handle signals
  process.on("SIGTERM", () => {
    logToDaemonFile("Received SIGTERM");
    cleanupAndExit(0);
  });

  process.on("SIGINT", () => {
    logToDaemonFile("Received SIGINT");
    cleanupAndExit(0);
  });
}

// Start the daemon
main().catch((error) => {
  logToDaemonFile(`Fatal error: ${error.message}`);
  process.exit(1);
});
