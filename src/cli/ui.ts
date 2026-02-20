import { readFileSync } from "node:fs";

import chalk from "chalk";

const WORDMARK_LINES = [
  "  ██╗  ██╗██╗██╗   ██╗███████╗",
  "  ██║  ██║██║██║   ██║██╔════╝",
  "  ███████║██║██║   ██║█████╗  ",
  "  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ",
  "  ██║  ██║██║ ╚████╔╝ ███████╗",
  "  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝",
] as const;

const VERSION_PREFIX = "              v";
const HEADER_SEPARATOR = "  ────────────────────────────────";
const DEFAULT_SEPARATOR = "────────────────────────────────";

let cachedVersion: string | null = null;

export function renderHiveHeader(): void {
  for (const line of WORDMARK_LINES) {
    console.log(chalk.bold.whiteBright(line));
  }

  console.log("");
  console.log(chalk.dim(`${VERSION_PREFIX}${getCliVersion()}`));
  console.log(chalk.dim(HEADER_SEPARATOR));
}

export function renderSuccess(message: string): void {
  console.log(chalk.green(message));
}

export function renderError(message: string): void {
  console.error(chalk.red(message));
}

export function renderStep(message: string): void {
  console.log(chalk.whiteBright(message));
}

export function renderInfo(message: string): void {
  console.log(chalk.dim(message));
}

export function renderSeparator(text: string = DEFAULT_SEPARATOR): void {
  console.log(chalk.dim(text));
}

function getCliVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      cachedVersion = parsed.version.trim();
      return cachedVersion;
    }
  } catch {
    // Fall through to default when package metadata cannot be read.
  }

  cachedVersion = "0.0.0";
  return cachedVersion;
}
