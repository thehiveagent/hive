import { readFileSync } from "node:fs";
import process from "node:process";

import chalk from "chalk";

const WORDMARK_LINES = [
  "  ██╗  ██╗██╗██╗   ██╗███████╗",
  "  ██║  ██║██║██║   ██║██╔════╝",
  "  ███████║██║██║   ██║█████╗  ",
  "  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ",
  "  ██║  ██║██║ ╚████╔╝ ███████╗",
  "  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝",
] as const;

const COMMAND_CENTRE_LABEL = "COMMAND CENTRE";
const MAX_SEPARATOR_WIDTH = 72;
const MIN_SEPARATOR_WIDTH = 24;

let cachedVersion: string | null = null;

export function renderHiveHeader(pageTitle?: string): void {
  const terminalWidth = getTerminalWidth();
  const separator = "─".repeat(getSeparatorWidth(terminalWidth));

  for (const line of WORDMARK_LINES) {
    console.log(chalk.bold.whiteBright(centerText(line, terminalWidth)));
  }

  console.log("");
  console.log(chalk.dim(centerText(`v${getCliVersion()}`, terminalWidth)));

  const normalizedTitle = normalizePageTitle(pageTitle);
  const commandCentreTitle = normalizedTitle
    ? `${COMMAND_CENTRE_LABEL} · ${normalizedTitle}`
    : COMMAND_CENTRE_LABEL;

  console.log(chalk.whiteBright(centerText(commandCentreTitle, terminalWidth)));
  console.log(chalk.dim(centerText(separator, terminalWidth)));
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

export function renderSeparator(text?: string): void {
  if (text) {
    console.log(chalk.dim(text));
    return;
  }

  console.log(chalk.dim("─".repeat(getSeparatorWidth(getTerminalWidth()))));
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

function normalizePageTitle(pageTitle?: string): string {
  const trimmed = pageTitle?.trim() ?? "";
  if (trimmed.length === 0) {
    return "";
  }

  return trimmed.toUpperCase();
}

function getTerminalWidth(): number {
  if (!process.stdout.isTTY) {
    return 80;
  }

  const columns = process.stdout.columns;
  if (typeof columns !== "number" || columns < 20) {
    return 80;
  }

  return columns;
}

function centerText(value: string, totalWidth: number): string {
  if (value.length >= totalWidth) {
    return value;
  }

  const leftPadding = Math.floor((totalWidth - value.length) / 2);
  return `${" ".repeat(leftPadding)}${value}`;
}

function getSeparatorWidth(terminalWidth: number): number {
  const usableWidth = Math.max(MIN_SEPARATOR_WIDTH, terminalWidth - 8);
  return Math.min(MAX_SEPARATOR_WIDTH, usableWidth);
}
