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
import { createServer, type Server, type Socket } from "node:net";
import {
  closeHiveDatabase,
  claimNextQueuedTask,
  getHiveHomeDir,
  getPrimaryAgent,
  insertTask,
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  openHiveDatabase,
  resetRunningTasksToQueued,
  type TaskRecord,
  type HiveDatabase,
} from "../storage/db.js";
import { HiveAgent } from "../agent/agent.js";
import type { Provider } from "../providers/base.js";
import { createProvider } from "../providers/index.js";
import { initializeHiveCtxSession, type HiveCtxSession } from "../agent/hive-ctx.js";
import {
  createMessageHandler,
  type IntegrationPlatform,
  isDisabled,
  keychainGet,
  startDiscordIntegration,
  startSlackIntegration,
  startTelegramIntegration,
  startWhatsAppIntegration,
} from "../integrations/index.js";

const PORT = 2718;
const HEARTBEAT_INTERVAL_MS = readEnvNumber("HIVE_DAEMON_HEARTBEAT_MS", 30000, 250); // 30s default
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_MAX_FILES = 3;
const TASK_POLL_INTERVAL_MS = 10_000;

const HIVE_HOME = getHiveHomeDir();
const DAEMON_PID_FILE = path.join(HIVE_HOME, "daemon.pid");
const DAEMON_PORT_FILE = path.join(HIVE_HOME, "daemon.port");
const DAEMON_LOCK_FILE = path.join(HIVE_HOME, "daemon.lock");
const DAEMON_LOG_FILE = path.join(HIVE_HOME, "daemon.log");
const DAEMON_STOP_SENTINEL = path.join(HIVE_HOME, "daemon.stop");
const DAEMON_CTX_PATH = path.join(HIVE_HOME, "ctx");

// Daemon state
let startTime: number;
let db: HiveDatabase | null = null;
let agent: ReturnType<typeof getPrimaryAgent> | null = null;
let ctxSession: HiveCtxSession | null = null;
let provider: Provider | null = null;
let hiveAgent: HiveAgent | null = null;
let tcpServer: Server | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let taskPollInterval: NodeJS.Timeout | null = null;
let activeTaskId: string | null = null;
const cancelledTaskIds = new Set<string>();

// Integrations state
type IntegrationStatus = "not configured" | "disabled" | "starting" | "running" | "error";
const INTEGRATION_PLATFORMS: IntegrationPlatform[] = ["telegram", "whatsapp", "discord", "slack"];
const integrationStatuses: Record<IntegrationPlatform, IntegrationStatus> = {
  telegram: "not configured",
  whatsapp: "not configured",
  discord: "not configured",
  slack: "not configured",
};
const integrationStops = new Map<IntegrationPlatform, () => Promise<void>>();
const integrationRestartTimers = new Map<IntegrationPlatform, NodeJS.Timeout>();
const INTEGRATION_RESTART_DELAY_MS = 30_000;

function readEnvNumber(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

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
  resetRunningTasksToQueued(db);

  // Load agent profile
  logToDaemonFile("Loading agent profile...");
  agent = getPrimaryAgent(db);
  if (!agent) {
    logToDaemonFile(
      "Warning: No agent profile found. Daemon will start but agent features unavailable.",
    );
  }

  // Initialize provider
  if (agent) {
    try {
      logToDaemonFile(`Initializing provider (${agent.provider})...`);
      provider = await createProvider(agent.provider);
      hiveAgent = db ? new HiveAgent(db, provider, agent) : null;
    } catch (error) {
      provider = null;
      hiveAgent = null;
      logToDaemonFile(`Warning: Failed to initialize provider: ${String(error)}`);
    }

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

  // Fire-and-forget integrations boot (never block daemon startup).
  void startAllIntegrations().catch((error) => {
    logToDaemonFile(`[integrations] boot error: ${String(error)}`);
  });
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

      if (line.length === 0) {
        continue;
      }

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
      case "task_cancel":
        handleTaskCancel(parsed, socket);
        break;
      case "integrations_reload":
        void handleIntegrationsReload(socket);
        break;
      default:
        sendResponse(socket, { error: `Unknown command type: ${parsed.type}` });
    }
  } catch {
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
    taskWorker: {
      activeTaskId,
    },
    integrations: integrationStatuses,
    timestamp: now,
  };

  sendResponse(socket, response);
}

async function handleIntegrationsReload(socket: Socket): Promise<void> {
  sendResponse(socket, { ok: true });
  await reloadIntegrations();
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
 * Handle task command
 */
function handleTask(
  parsed: { payload?: { id?: string; title?: string; agent_id?: string | null } },
  socket: Socket,
): void {
  if (!db) {
    sendResponse(socket, { accepted: false, error: "database unavailable" });
    return;
  }

  const id = parsed.payload?.id;
  const title = parsed.payload?.title;
  if (!id || !title) {
    sendResponse(socket, { accepted: false, error: "missing task id/title" });
    return;
  }

  try {
    insertTask(db, { id, title, agentId: parsed.payload?.agent_id ?? agent?.id ?? null });
    sendResponse(socket, { accepted: true, id });
    logToDaemonFile(`worker: queued task ${id}`);
    void tickTaskWorker();
  } catch (error) {
    sendResponse(socket, { accepted: false, error: String(error) });
  }
}

function handleTaskCancel(parsed: { id?: string }, socket: Socket): void {
  if (!db) {
    sendResponse(socket, { ok: false, error: "database unavailable" });
    return;
  }

  const id = parsed.id;
  if (!id) {
    sendResponse(socket, { ok: false, error: "missing id" });
    return;
  }

  cancelledTaskIds.add(id);

  try {
    markTaskFailed(db, id, "cancelled");
    sendResponse(socket, { ok: true });
  } catch (error) {
    sendResponse(socket, { ok: false, error: String(error) });
  }
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

function setIntegrationStatus(platform: IntegrationPlatform, status: IntegrationStatus): void {
  integrationStatuses[platform] = status;
}

function clearRestartTimer(platform: IntegrationPlatform): void {
  const timer = integrationRestartTimers.get(platform);
  if (timer) {
    clearTimeout(timer);
    integrationRestartTimers.delete(platform);
  }
}

function scheduleIntegrationRestart(platform: IntegrationPlatform, reason: string): void {
  clearRestartTimer(platform);
  setIntegrationStatus(platform, "error");
  logToDaemonFile(`[integrations] ${platform} crashed: ${reason} (restart in 30s)`);
  const timer = setTimeout(() => {
    void startIntegration(platform).catch((error) => {
      logToDaemonFile(`[integrations] ${platform} restart failed: ${String(error)}`);
      scheduleIntegrationRestart(platform, String(error));
    });
  }, INTEGRATION_RESTART_DELAY_MS);
  integrationRestartTimers.set(platform, timer);
}

async function stopIntegration(platform: IntegrationPlatform): Promise<void> {
  clearRestartTimer(platform);
  const stop = integrationStops.get(platform);
  integrationStops.delete(platform);
  if (stop) {
    try {
      await stop();
    } catch (error) {
      logToDaemonFile(`[integrations] stop ${platform} error: ${String(error)}`);
    }
  }
}

async function startAllIntegrations(): Promise<void> {
  for (const platform of INTEGRATION_PLATFORMS) {
    // eslint-disable-next-line no-await-in-loop
    await startIntegration(platform);
  }
}

async function reloadIntegrations(): Promise<void> {
  logToDaemonFile("[integrations] reloading...");
  for (const platform of INTEGRATION_PLATFORMS) {
    // eslint-disable-next-line no-await-in-loop
    await stopIntegration(platform);
  }
  await startAllIntegrations();
  logToDaemonFile("[integrations] reload complete");
}

async function startIntegration(platform: IntegrationPlatform): Promise<void> {
  await stopIntegration(platform);

  if (isDisabled(platform)) {
    setIntegrationStatus(platform, "disabled");
    logToDaemonFile(`[integrations] ${platform} disabled`);
    return;
  }

  if (!db) {
    setIntegrationStatus(platform, "error");
    logToDaemonFile(`[integrations] ${platform} cannot start: database unavailable`);
    return;
  }

  const handler = createMessageHandler({
    db,
    hiveAgent,
    ctx: ctxSession,
    provider,
    model: agent?.model ?? null,
    log: (line) => logToDaemonFile(line),
  });

  const getStatusText = async (): Promise<string> => {
    const now = Date.now();
    const uptime = Math.floor((now - startTime) / 1000);
    return `Daemon running · uptime ${uptime}s · agent ${agent?.agent_name ?? "not set"} · provider ${agent?.provider ?? "none"} · model ${agent?.model ?? "none"}`;
  };

  const getTasksText = async (): Promise<string> => {
    if (!db) return "DB unavailable.";
    const rows = db
      .prepare(
        `
        SELECT id, title, status, created_at, error
        FROM tasks
        ORDER BY datetime(created_at) DESC
        LIMIT 10
      `,
      )
      .all() as Array<{ id: string; title: string; status: string; created_at: string; error?: string }>;

    if (rows.length === 0) {
      return "No tasks yet.";
    }
    return rows
      .map((t) => `• ${t.status} · ${t.title}${t.error ? ` (${t.error})` : ""}`)
      .join("\n");
  };

  setIntegrationStatus(platform, "starting");

  try {
    if (platform === "telegram") {
      const token = await keychainGet("telegram");
      if (!token) {
        setIntegrationStatus(platform, "not configured");
        return;
      }

      const running = await startTelegramIntegration({
        token,
        log: (line) => logToDaemonFile(line),
        getStatusText,
        getTasksText,
        handleMessage: async (incoming) => {
          const outgoing = await handler(incoming);
          return { text: outgoing.text, replyTo: outgoing.replyTo, to: outgoing.to };
        },
      });

      integrationStops.set(platform, running.stop);
      setIntegrationStatus(platform, "running");
      return;
    }

    if (platform === "whatsapp") {
      const sessionDir = path.join(HIVE_HOME, "integrations", "whatsapp", "session");
      // Treat session dir existence as "configured"
      if (!fs.existsSync(sessionDir)) {
        setIntegrationStatus(platform, "not configured");
        return;
      }

      const running = await startWhatsAppIntegration({
        sessionDir,
        agentName: agent?.agent_name ?? "hive",
        log: (line) => logToDaemonFile(line),
        handleMessage: async (incoming) => {
          const outgoing = await handler(incoming);
          return { text: outgoing.text };
        },
      });

      integrationStops.set(platform, running.stop);
      setIntegrationStatus(platform, "running");
      return;
    }

    if (platform === "discord") {
      const token = await keychainGet("discord");
      if (!token) {
        setIntegrationStatus(platform, "not configured");
        return;
      }

      const running = await startDiscordIntegration({
        token,
        log: (line) => logToDaemonFile(line),
        handleIncoming: async (incoming, reply) => {
          const outgoing = await handler(incoming);
          await reply(outgoing.text);
        },
      });

      integrationStops.set(platform, running.stop);
      setIntegrationStatus(platform, "running");
      return;
    }

    if (platform === "slack") {
      const raw = await keychainGet("slack");
      if (!raw) {
        setIntegrationStatus(platform, "not configured");
        return;
      }

      let tokens: any = null;
      try {
        tokens = JSON.parse(raw);
      } catch {
        tokens = null;
      }

      if (!tokens?.botToken) {
        setIntegrationStatus(platform, "not configured");
        return;
      }

      const running = await startSlackIntegration({
        tokens,
        log: (line) => logToDaemonFile(line),
        getStatusText,
        getTasksText,
        handleIncoming: async (incoming) => {
          const outgoing = await handler(incoming);
          return outgoing.text;
        },
      });

      integrationStops.set(platform, running.stop);
      setIntegrationStatus(platform, "running");
      return;
    }
  } catch (error) {
    scheduleIntegrationRestart(platform, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Start TCP server
 */
async function startTcpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer(handleConnection);
    tcpServer = server;

    server.on("error", (error: Error) => {
      logToDaemonFile(`TCP server error: ${error.message}`);
      reject(error);
    });

    // Try to bind to port 2718, increment if needed
    let currentPort = PORT;

    const bindNextPort = () => {
      server.listen(currentPort, "127.0.0.1", () => {
        writePortFile(currentPort);
        logToDaemonFile(`TCP server listening on 127.0.0.1:${currentPort}`);
        resolve();
      });
    };

    server.on("listening", () => {
      // Port is already written in the callback above
    });

    server.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        logToDaemonFile(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
        currentPort += 1;
        server.close();
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

  // Stop integrations
  for (const platform of INTEGRATION_PLATFORMS) {
    // eslint-disable-next-line no-await-in-loop
    await stopIntegration(platform);
  }

  // Clear heartbeat interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (taskPollInterval) {
    clearInterval(taskPollInterval);
    taskPollInterval = null;
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
  startTaskWorker();

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

function startTaskWorker(): void {
  logToDaemonFile(`worker: started (poll ${TASK_POLL_INTERVAL_MS}ms)`);
  taskPollInterval = setInterval(() => {
    void tickTaskWorker().catch((error) => {
      logToDaemonFile(`Task worker error: ${String(error)}`);
    });
  }, TASK_POLL_INTERVAL_MS);

  // Kick immediately on boot.
  void tickTaskWorker().catch((error) => {
    logToDaemonFile(`Task worker error: ${String(error)}`);
  });
}

async function tickTaskWorker(): Promise<void> {
  logToDaemonFile("worker: checking for queued tasks");

  if (!db) {
    logToDaemonFile("worker: database unavailable");
    return;
  }

  if (!agent) {
    logToDaemonFile("worker: no agent profile (run `hive init`), skipping");
    return;
  }

  if (activeTaskId) {
    logToDaemonFile(`worker: busy (active ${activeTaskId}), skipping`);
    return;
  }

  let pickedAny = false;
  while (true) {
    const next = claimNextQueuedTask(db);
    if (!next) {
      if (!pickedAny) {
        logToDaemonFile("worker: no queued tasks");
      }
      return;
    }

    pickedAny = true;
    activeTaskId = next.id;
    logToDaemonFile(`worker: picked up task ${next.id}`);
    try {
      await runTask(next);
    } finally {
      activeTaskId = null;
    }
  }
}

async function runTask(task: TaskRecord): Promise<void> {
  if (!db || !agent) {
    return;
  }

  if (cancelledTaskIds.has(task.id)) {
    logToDaemonFile(`worker: task ${task.id} cancelled before start`);
    markTaskFailed(db, task.id, "cancelled");
    cancelledTaskIds.delete(task.id);
    return;
  }

  markTaskRunning(db, task.id);
  logToDaemonFile(`worker: started task ${task.id}`);

  try {
    if (!hiveAgent) {
      // Recover if provider init failed on boot (e.g. missing key at the time).
      logToDaemonFile(`worker: initializing provider on-demand (${agent.provider})`);
      provider = await createProvider(agent.provider);
      hiveAgent = new HiveAgent(db, provider, agent);
    }

    const context = ctxSession ? await ctxSession.build(task.title) : null;
    let assistantText = "";

    for await (const event of hiveAgent.chat(task.title, {
      title: `Task ${task.id}`,
      contextSystemPrompt: context?.system,
      disableLegacyEpisodeStore: Boolean(ctxSession),
    })) {
      if (cancelledTaskIds.has(task.id)) {
        throw new Error("cancelled");
      }
      if (event.type === "token") {
        assistantText += event.token;
      }
    }

    if (ctxSession) {
      await Promise.resolve(ctxSession.episode(task.title, assistantText)).catch(() => {});
    }

    markTaskDone(db, task.id, assistantText);
    logToDaemonFile(`worker: completed task ${task.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markTaskFailed(db, task.id, message);
    logToDaemonFile(`worker: failed task ${task.id}: ${message}`);
  } finally {
    cancelledTaskIds.delete(task.id);
  }
}
