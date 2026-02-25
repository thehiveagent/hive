import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import process from "node:process";

import Database from "better-sqlite3";
import { Command } from "commander";
import fetch from "node-fetch";
import keytar from "keytar";

import { normalizeProviderName, type ProviderName } from "../../providers/base.js";
import { readAuthorizedConfig, readDisabledConfig } from "../../integrations/auth.js";
import {
  closeHiveDatabase,
  countTasksByStatus,
  getHiveDatabasePath,
  getHiveHomeDir,
  getMetaValue,
  getPrimaryAgent,
  type HiveDatabase,
} from "../../storage/db.js";
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_HEX,
  DEFAULT_THEME_NAME,
  isValidHexColor,
  type ThemeName,
} from "../theme.js";
import { renderError, renderHiveHeader, renderInfo, renderSuccess } from "../ui.js";

const KEYCHAIN_SERVICE = "hive";
const PROMPTS_DIRECTORY = "prompts";
const CTX_DIRECTORY = "ctx";
const DEFAULT_DAEMON_PORT = 2718;
const PROVIDER_PING_TIMEOUT_MS = 5_000;
const OLLAMA_PING_TIMEOUT_MS = 5_000;
const DB_SIZE_WARNING_BYTES = 100 * 1024 * 1024;
const NODE_MAJOR_WARNING_VERSION = 20;
const CHECK_LABEL_WIDTH = 22;

interface DoctorOptions {
  showHeader?: boolean;
}

interface ThemeDetails {
  name: ThemeName;
  hex: string;
}

interface CheckCounter {
  warnings: number;
  errors: number;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run a full Hive health check")
    .action(async () => {
      await runDoctorCommand();
    });
}

export async function runDoctorCommand(options: DoctorOptions = {}): Promise<void> {
  const showHeader = options.showHeader ?? true;
  if (showHeader) {
    renderHiveHeader("Doctor");
  }

  renderInfo("");
  renderInfo("Running diagnostics...");
  renderInfo("");

  const counters: CheckCounter = { warnings: 0, errors: 0 };
  const dbPath = getHiveDatabasePath();
  const promptsPath = join(getHiveHomeDir(), PROMPTS_DIRECTORY);
  const ctxPath = join(getHiveHomeDir(), CTX_DIRECTORY);

  let dbSizeBytes = 0;
  let db: HiveDatabase | null = null;
  let providerName: ProviderName | null = null;
  let providerLookupError: string | null = null;
  let keychainApiKey: string | null = null;

  const databaseCheck = checkDatabase(dbPath);
  dbSizeBytes = databaseCheck.sizeBytes;
  db = databaseCheck.ok ? databaseCheck.db : null;

  let agentName = "missing";
  if (db) {
    const agent = getPrimaryAgent(db);
    if (agent) {
      agentName = agent.agent_name?.trim() ? agent.agent_name : agent.name;
      renderSuccess(formatCheckLine("Agent initialized", agentName));

      try {
        providerName = normalizeProviderName(agent.provider);
      } catch {
        providerName = null;
        providerLookupError = `unsupported (${agent.provider})`;
      }
    } else {
      renderFailure("Agent initialized", "not initialized", counters);
    }
  } else {
    renderFailure("Agent initialized", "not checked (database unavailable)", counters);
  }

  if (databaseCheck.ok) {
    renderSuccess(
      formatCheckLine("Database", `${displayPath(dbPath)} (${formatBytes(dbSizeBytes)})`),
    );
  } else {
    renderFailure("Database", databaseCheck.message, counters);
  }

  if (dbSizeBytes > DB_SIZE_WARNING_BYTES) {
    renderWarning(
      "Database size",
      `${formatBytes(dbSizeBytes)} exceeds ${formatBytes(DB_SIZE_WARNING_BYTES)}`,
      counters,
    );
  }

  if (providerName) {
    if (providerName === "ollama") {
      renderSuccess(formatCheckLine("API Key", "not required (ollama)"));
    } else {
      keychainApiKey = await readKeychainApiKey(providerName);
      if (keychainApiKey && keychainApiKey.trim().length > 0) {
        renderSuccess(formatCheckLine("API Key", "set"));
      } else {
        renderFailure("API Key", "missing in keychain", counters);
      }
    }
  } else if (providerLookupError) {
    renderFailure("API Key", "not checked (provider unsupported)", counters);
  } else {
    renderFailure("API Key", "not checked (provider unavailable)", counters);
  }

  if (providerName) {
    const providerReachable = await checkProviderReachable(providerName, keychainApiKey);
    if (providerReachable.ok) {
      renderSuccess(formatCheckLine("Provider", `${providerName} — reachable`));
    } else if (providerReachable.warning) {
      renderWarning("Provider", `${providerName} — ${providerReachable.message}`, counters);
    } else {
      renderFailure("Provider", `${providerName} — ${providerReachable.message}`, counters);
    }
  } else if (providerLookupError) {
    renderFailure("Provider", providerLookupError, counters);
  } else {
    renderFailure("Provider", "not checked (provider unavailable)", counters);
  }

  const promptsCheck = checkPromptsDirectory(promptsPath);
  if (promptsCheck.ok) {
    renderSuccess(formatCheckLine("Prompts", `${promptsCheck.fileCount} files loaded`));
  } else {
    renderFailure("Prompts", promptsCheck.message, counters);
  }

  const hiveCtxCheck = await checkHiveCtxStorage(ctxPath);
  if (hiveCtxCheck.ok) {
    renderSuccess(formatCheckLine("hive-ctx", hiveCtxCheck.message));
  } else if (hiveCtxCheck.warning) {
    renderWarning("hive-ctx", hiveCtxCheck.message, counters);
  } else {
    renderFailure("hive-ctx", hiveCtxCheck.message, counters);
  }

  if (db) {
    const taskCounts = countTasksByStatus(db);
    const daemonStatus = await probeDaemonStatus();
    const summary = `${taskCounts.queued} queued · ${taskCounts.running} running · ${taskCounts.done} done`;
    if (taskCounts.queued + taskCounts.running > 0 && !daemonStatus) {
      renderFailure("Task worker", `${summary} · daemon unreachable`, counters);
    } else if (daemonStatus) {
      renderSuccess(formatCheckLine("Task worker", `${summary} · running`));
    } else {
      renderSuccess(formatCheckLine("Task worker", `${summary} · idle`));
    }

    const integrations = await diagnoseIntegrations(daemonStatus);
    if (integrations.warning) {
      renderWarning("Integrations", integrations.summary, counters);
    } else {
      renderSuccess(formatCheckLine("Integrations", integrations.summary));
    }
    renderInfo(formatInfoLine("Auth", integrations.authSummary));
  } else {
    renderFailure("Task worker", "not checked (database unavailable)", counters);
  }

  if (db) {
    const theme = resolveThemeDetails(db);
    renderSuccess(formatCheckLine("Theme", `${theme.name} ${theme.hex}`));
  } else {
    renderFailure("Theme", "not checked (database unavailable)", counters);
  }

  const nodeCheck = checkNodeVersion(process.version);
  if (nodeCheck.ok) {
    renderSuccess(formatCheckLine("Node version", process.version));
  } else {
    renderWarning("Node version", nodeCheck.message, counters);
  }

  const playwrightCheck = await checkPlaywrightInstallation();
  if (playwrightCheck.ok) {
    renderSuccess(formatCheckLine("Playwright", "chromium installed"));
  } else {
    renderFailure("Playwright", playwrightCheck.message, counters);
  }

  if (providerName === "ollama") {
    const ollamaCheck = await checkOllamaRunning();
    if (ollamaCheck.ok) {
      renderSuccess(formatCheckLine("Ollama", "running"));
    } else {
      renderWarning("Ollama", "not running", counters);
    }
  }

  if (db) {
    const messageCount = countRowsIfTableExists(db, "messages");
    const conversationCount = countRowsIfTableExists(db, "conversations");
    const episodeCount = countRowsIfTableExists(db, "episodes");

    if (episodeCount === null) {
      renderInfo(formatInfoLine("Memory", "episodes table not found"));
    } else {
      renderInfo(formatInfoLine("Memory", `${episodeCount} episodes stored`));
    }

    if (messageCount === null) {
      renderInfo(formatInfoLine("Messages", "messages table not found"));
    } else {
      renderInfo(formatInfoLine("Messages", `${messageCount} total`));
    }

    if (conversationCount === null) {
      renderInfo(formatInfoLine("Conversations", "conversations table not found"));
    } else {
      renderInfo(formatInfoLine("Conversations", `${conversationCount} total`));
    }
  } else {
    renderInfo(formatInfoLine("Memory", "not checked"));
    renderInfo(formatInfoLine("Conversations", "not checked"));
  }

  renderInfo("");
  renderSummary(counters);

  if (db) {
    closeHiveDatabase(db);
  }
}

async function diagnoseIntegrations(
  daemonStatus: Record<string, unknown> | null,
): Promise<{ summary: string; authSummary: string; warning: boolean }> {
  const platforms = ["telegram", "whatsapp", "discord", "slack"] as const;

  const safeKeychainHas = async (account: string): Promise<boolean> => {
    try {
      const value = await keytar.getPassword(KEYCHAIN_SERVICE, account);
      return Boolean(value && value.trim().length > 0);
    } catch {
      return false;
    }
  };

  const configured: Record<(typeof platforms)[number], boolean> = {
    telegram: await safeKeychainHas("telegram"),
    discord: await safeKeychainHas("discord"),
    slack: await safeKeychainHas("slack"),
    whatsapp: fs.existsSync(join(getHiveHomeDir(), "integrations", "whatsapp", "session")),
  };

  const disabled = readDisabledConfig();
  const auth = readAuthorizedConfig();

  const running = (daemonStatus?.integrations ?? null) as Record<string, string> | null;
  const daemonReachable = Boolean(daemonStatus);

  const parts = platforms.map((p) => {
    if (disabled[p]) return `${p} disabled`;
    if (!configured[p]) return `${p} not configured`;
    const r = running?.[p];
    if (r === "running") return `${p} running`;
    if (daemonReachable) return `${p} ${r ?? "configured"}`;
    return `${p} configured`;
  });

  const authSummary = platforms
    .map((p) => `${p} ${(auth as any)[p]?.length ?? 0}`)
    .join("  ");

  const anyConfigured = Object.values(configured).some(Boolean);
  const warning = anyConfigured && !daemonReachable;

  return {
    summary: parts.join(" · "),
    authSummary,
    warning,
  };
}

function checkDatabase(
  databasePath: string,
):
  | { ok: true; db: HiveDatabase; sizeBytes: number }
  | { ok: false; message: string; sizeBytes: number } {
  if (!fs.existsSync(databasePath)) {
    return {
      ok: false,
      message: `${displayPath(databasePath)} not found`,
      sizeBytes: 0,
    };
  }

  const stats = fs.statSync(databasePath);
  if (!stats.isFile()) {
    return {
      ok: false,
      message: `${displayPath(databasePath)} is not a file`,
      sizeBytes: 0,
    };
  }

  try {
    const db = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });

    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      db.close();
      return {
        ok: false,
        message: `integrity check failed (${String(integrity)})`,
        sizeBytes: stats.size,
      };
    }

    return { ok: true, db, sizeBytes: stats.size };
  } catch (error) {
    return {
      ok: false,
      message: `unreadable (${formatError(error)})`,
      sizeBytes: stats.size,
    };
  }
}

async function readKeychainApiKey(providerName: ProviderName): Promise<string | null> {
  try {
    return await keytar.getPassword(KEYCHAIN_SERVICE, providerName);
  } catch {
    return null;
  }
}

async function checkProviderReachable(
  providerName: ProviderName,
  apiKey: string | null,
): Promise<{ ok: boolean; warning?: boolean; message?: string }> {
  const target = buildProviderPingTarget(providerName, apiKey);
  if (!target) {
    return {
      ok: false,
      message: "missing API key",
    };
  }

  try {
    const response = await fetchWithTimeout(
      target.url,
      {
        method: "GET",
        headers: target.headers,
      },
      PROVIDER_PING_TIMEOUT_MS,
    );

    if (response.ok) {
      return { ok: true };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `auth failed (${response.status})` };
    }

    if (response.status >= 500) {
      return { ok: false, warning: true, message: `service unavailable (${response.status})` };
    }

    return { ok: false, message: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      warning: isTimeoutError(error),
      message: isTimeoutError(error) ? "timeout after 5s" : formatError(error),
    };
  }
}

function buildProviderPingTarget(
  providerName: ProviderName,
  apiKey: string | null,
): { url: string; headers?: Record<string, string> } | null {
  switch (providerName) {
    case "openai":
      return buildOpenAICompatiblePing(
        process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey,
      );
    case "google":
      return buildOpenAICompatiblePing(
        process.env.GOOGLE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey,
      );
    case "groq":
      return buildOpenAICompatiblePing(
        process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
        apiKey,
      );
    case "mistral":
      return buildOpenAICompatiblePing(
        process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
        apiKey,
      );
    case "openrouter":
      return buildOpenAICompatiblePing(
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        apiKey,
      );
    case "together":
      return buildOpenAICompatiblePing(
        process.env.TOGETHER_BASE_URL ?? "https://api.together.xyz/v1",
        apiKey,
      );
    case "ollama":
      return {
        url: "http://localhost:11434/api/tags",
      };
    case "anthropic":
      if (!apiKey || apiKey.trim().length === 0) {
        return null;
      }

      return {
        url: "https://api.anthropic.com/v1/models",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      };
    default:
      return null;
  }
}

function buildOpenAICompatiblePing(
  baseUrl: string,
  apiKey: string | null,
): { url: string; headers?: Record<string, string> } | null {
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }

  return {
    url: `${baseUrl.replace(/\/$/, "")}/models`,
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  };
}

function checkPromptsDirectory(
  promptsPath: string,
): { ok: true; fileCount: number } | { ok: false; message: string } {
  if (!fs.existsSync(promptsPath)) {
    return {
      ok: false,
      message: `${ensureTrailingSlash(displayPath(promptsPath))} missing`,
    };
  }

  const stats = fs.statSync(promptsPath);
  if (!stats.isDirectory()) {
    return {
      ok: false,
      message: `${displayPath(promptsPath)} is not a directory`,
    };
  }

  const fileCount = countFilesRecursively(promptsPath);
  if (fileCount <= 0) {
    return {
      ok: false,
      message: `${ensureTrailingSlash(displayPath(promptsPath))} has no files`,
    };
  }

  return {
    ok: true,
    fileCount,
  };
}

async function checkHiveCtxStorage(ctxPath: string): Promise<{
  ok: boolean;
  warning?: boolean;
  message: string;
}> {
  let hiveCtxInstalled = false;
  try {
    await import("@imisbahk/hive-ctx");
    hiveCtxInstalled = true;
  } catch {
    hiveCtxInstalled = false;
  }

  if (!hiveCtxInstalled) {
    return { ok: false, warning: true, message: "not installed (legacy context pipeline active)" };
  }

  if (!fs.existsSync(ctxPath)) {
    return { ok: false, message: `${ensureTrailingSlash(displayPath(ctxPath))} missing` };
  }

  const graphDb = join(ctxPath, "hive_graph.sqlite");
  const memoryDb = join(ctxPath, "hive_memory.sqlite");

  if (!fs.existsSync(graphDb) || !fs.existsSync(memoryDb)) {
    return {
      ok: false,
      message: "storage missing (expected hive_graph.sqlite + hive_memory.sqlite)",
    };
  }

  return { ok: true, message: "storage ready" };
}

async function probeDaemonStatus(): Promise<Record<string, unknown> | null> {
  const hiveHome = getHiveHomeDir();
  const portFile = join(hiveHome, "daemon.port");
  const port = readPortFile(portFile) ?? DEFAULT_DAEMON_PORT;

  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "status" }) + "\n");
    });

    let buffer = "";
    let responded = false;

    socket.on("data", (data: Buffer) => {
      if (responded) {
        return;
      }
      buffer += data.toString();
      try {
        const response = JSON.parse(buffer) as Record<string, unknown>;
        responded = true;
        socket.end();
        resolve(response);
      } catch {
        // wait for more data
      }
    });

    socket.on("error", () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });

    socket.setTimeout(500, () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });
  });
}

function readPortFile(portFile: string): number | null {
  try {
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const port = Number.parseInt(raw, 10);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

function checkNodeVersion(version: string): { ok: boolean; message: string } {
  const major = parseNodeMajorVersion(version);
  if (major !== null && major >= NODE_MAJOR_WARNING_VERSION) {
    return {
      ok: true,
      message: version,
    };
  }

  return {
    ok: false,
    message: `${version} (recommended v20+)`,
  };
}

function parseNodeMajorVersion(version: string): number | null {
  const match = /^v(\d+)/.exec(version.trim());
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? "", 10);
  return Number.isNaN(major) ? null : major;
}

async function checkPlaywrightInstallation(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const playwright = (await import("playwright")) as {
      chromium?: {
        executablePath: () => string;
      };
    };

    const executablePath = playwright.chromium?.executablePath();
    if (!executablePath || !fs.existsSync(executablePath)) {
      return { ok: false, message: "chromium not installed" };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "playwright not installed" };
  }
}

async function checkOllamaRunning(): Promise<{ ok: boolean }> {
  try {
    const response = await fetchWithTimeout(
      "http://localhost:11434",
      { method: "GET" },
      OLLAMA_PING_TIMEOUT_MS,
    );

    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

function resolveThemeDetails(db: HiveDatabase): ThemeDetails {
  const rawThemeName = getMetaValue(db, "theme");
  const rawThemeHex = getMetaValue(db, "theme_hex");

  if (rawThemeName && rawThemeName in BUILT_IN_THEMES) {
    const name = rawThemeName as keyof typeof BUILT_IN_THEMES;
    return { name, hex: BUILT_IN_THEMES[name] };
  }

  if (rawThemeName === "custom" && rawThemeHex && isValidHexColor(rawThemeHex)) {
    return { name: "custom", hex: rawThemeHex.toUpperCase() };
  }

  return {
    name: DEFAULT_THEME_NAME,
    hex: DEFAULT_THEME_HEX,
  };
}

function countRowsIfTableExists(db: HiveDatabase, tableName: string): number | null {
  if (!tableExists(db, tableName)) {
    return null;
  }

  const row = db.prepare(`SELECT COUNT(1) AS count FROM ${tableName}`).get() as { count: number };

  return row.count;
}

function tableExists(db: HiveDatabase, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
}

function countFilesRecursively(path: string): number {
  let total = 0;
  const entries = fs.readdirSync(path, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(path, entry.name);
    if (entry.isDirectory()) {
      total += countFilesRecursively(absolutePath);
      continue;
    }

    if (entry.isFile()) {
      total += 1;
    }
  }

  return total;
}

function formatCheckLine(label: string, value: string): string {
  return `${label.padEnd(CHECK_LABEL_WIDTH, " ")} ${value}`;
}

function formatInfoLine(label: string, value: string): string {
  return `· ${formatCheckLine(label, value)}`;
}

function renderFailure(label: string, value: string, counters: CheckCounter): void {
  counters.errors += 1;
  renderError(`✗ ${formatCheckLine(label, value)}`);
}

function renderWarning(label: string, value: string, counters: CheckCounter): void {
  counters.warnings += 1;
  renderError(`✗ ${formatCheckLine(label, value)}`);
}

function renderSummary(counters: CheckCounter): void {
  if (counters.errors === 0 && counters.warnings === 0) {
    renderSuccess("All checks passed.");
    return;
  }

  const warningWord = counters.warnings === 1 ? "warning" : "warnings";
  const errorWord = counters.errors === 1 ? "error" : "errors";
  const summary = `${counters.warnings} ${warningWord}, ${counters.errors} ${errorWord}.`;

  if (counters.errors > 0) {
    renderError(summary);
    return;
  }

  renderInfo(summary);
}

async function fetchWithTimeout(
  url: string,
  init: {
    method: "GET";
    headers?: Record<string, string>;
  },
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: init.method,
      headers: init.headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { name?: string; type?: string };
  return maybeError.name === "AbortError" || maybeError.type === "aborted";
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
