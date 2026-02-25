import * as fs from "node:fs";
import * as path from "node:path";

import { getHiveHomeDir } from "../storage/db.js";

export type IntegrationPlatform = "whatsapp" | "telegram" | "discord" | "slack";

export interface AuthorizedConfig {
  telegram: string[];
  whatsapp: string[];
  discord: string[];
  slack: string[];
}

export interface PendingAuthRequest {
  platform: IntegrationPlatform;
  from: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastText?: string;
}

const DEFAULT_AUTH: AuthorizedConfig = {
  telegram: [],
  whatsapp: [],
  discord: [],
  slack: [],
};

function getIntegrationsDir(): string {
  return path.join(getHiveHomeDir(), "integrations");
}

export function getAuthorizedFilePath(): string {
  return path.join(getIntegrationsDir(), "authorized.json");
}

export function getPendingAuthFilePath(): string {
  return path.join(getIntegrationsDir(), "pending.json");
}

export function getDisabledFilePath(): string {
  return path.join(getIntegrationsDir(), "disabled.json");
}

function ensureIntegrationsDir(): void {
  const dir = getIntegrationsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  ensureIntegrationsDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function readAuthorizedConfig(): AuthorizedConfig {
  const config = readJsonFile<Partial<AuthorizedConfig>>(getAuthorizedFilePath(), {});
  return {
    telegram: Array.isArray(config.telegram) ? config.telegram.map(String) : [],
    whatsapp: Array.isArray(config.whatsapp) ? config.whatsapp.map(String) : [],
    discord: Array.isArray(config.discord) ? config.discord.map(String) : [],
    slack: Array.isArray(config.slack) ? config.slack.map(String) : [],
  };
}

export function writeAuthorizedConfig(config: AuthorizedConfig): void {
  writeJsonFile(getAuthorizedFilePath(), config);
}

export function isAuthorized(platform: IntegrationPlatform, from: string): boolean {
  const config = readAuthorizedConfig();
  const list = config[platform] ?? [];
  return list.includes(from);
}

export function addAuthorized(platform: IntegrationPlatform, id: string): void {
  const config = readAuthorizedConfig();
  const set = new Set(config[platform] ?? []);
  set.add(id);
  writeAuthorizedConfig({ ...config, [platform]: Array.from(set) } as AuthorizedConfig);
  removePending(platform, id);
}

export function removeAuthorized(platform: IntegrationPlatform, id: string): void {
  const config = readAuthorizedConfig();
  writeAuthorizedConfig({
    ...config,
    [platform]: (config[platform] ?? []).filter((v) => v !== id),
  } as AuthorizedConfig);
}

export function listPendingAuth(): PendingAuthRequest[] {
  const rows = readJsonFile<PendingAuthRequest[]>(getPendingAuthFilePath(), []);
  return Array.isArray(rows) ? rows : [];
}

export function upsertPendingAuth(request: {
  platform: IntegrationPlatform;
  from: string;
  timestamp: number;
  text?: string;
}): void {
  const pending = listPendingAuth();
  const key = `${request.platform}:${request.from}`;
  const existing = pending.find((row) => `${row.platform}:${row.from}` === key);

  if (existing) {
    existing.lastSeenAt = request.timestamp;
    existing.lastText = request.text;
  } else {
    pending.push({
      platform: request.platform,
      from: request.from,
      firstSeenAt: request.timestamp,
      lastSeenAt: request.timestamp,
      lastText: request.text,
    });
  }

  writeJsonFile(getPendingAuthFilePath(), pending);
}

export function removePending(platform: IntegrationPlatform, from: string): void {
  const pending = listPendingAuth();
  writeJsonFile(
    getPendingAuthFilePath(),
    pending.filter((row) => !(row.platform === platform && row.from === from)),
  );
}

export function readDisabledConfig(): Partial<Record<IntegrationPlatform, boolean>> {
  const disabled = readJsonFile<Partial<Record<IntegrationPlatform, boolean>>>(
    getDisabledFilePath(),
    {},
  );
  return disabled && typeof disabled === "object" ? disabled : {};
}

export function setDisabled(platform: IntegrationPlatform, disabled: boolean): void {
  const current = readDisabledConfig();
  writeJsonFile(getDisabledFilePath(), { ...current, [platform]: disabled });
}

export function isDisabled(platform: IntegrationPlatform): boolean {
  const disabled = readDisabledConfig();
  return disabled[platform] === true;
}

