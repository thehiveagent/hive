import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import fetch from "node-fetch";

import {
  type HiveDatabase,
  getHiveHomeDir,
  getMetaValue,
  setMetaValue,
} from "../storage/db.js";

const PROMPTS_LAST_CHECKED_KEY = "prompts_last_checked";
const PROMPTS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REMOTE_PROMPTS_BASE_URL =
  "https://raw.githubusercontent.com/thehiveagent/hive/master/prompts/";

export async function maybeAutoUpdatePromptsOnBoot(
  db: HiveDatabase,
  logDim: (message: string) => void,
): Promise<void> {
  const promptsDirectory = ensurePromptsDirectory();

  const lastCheckedRaw = getMetaValue(db, PROMPTS_LAST_CHECKED_KEY);
  const lastCheckedAt = lastCheckedRaw ? Date.parse(lastCheckedRaw) : Number.NaN;
  if (Number.isFinite(lastCheckedAt)) {
    const elapsed = Date.now() - lastCheckedAt;
    if (elapsed >= 0 && elapsed < PROMPTS_CHECK_INTERVAL_MS) {
      return;
    }
  }

  try {
    const listing = await fetch(REMOTE_PROMPTS_BASE_URL);
    if (!listing.ok) {
      return;
    }

    const listingBody = await listing.text();
    const remoteFiles = extractMarkdownFilenames(listingBody);
    if (remoteFiles.length === 0) {
      return;
    }

    const localFiles = new Set(
      safeReadDirFiles(promptsDirectory).filter((name) => name.endsWith(".md")),
    );

    const missing = remoteFiles.filter((name) => !localFiles.has(name));
    for (const filename of missing) {
      try {
        const response = await fetch(
          `${REMOTE_PROMPTS_BASE_URL}${encodeURIComponent(filename)}`,
        );
        if (!response.ok) {
          continue;
        }

        const body = await response.text();
        const targetPath = join(promptsDirectory, filename);
        // Never overwrite existing local prompt files.
        writeFileSync(targetPath, body, { encoding: "utf8", flag: "wx" });
        logDim(`✦ New prompt loaded: ${filename}`);
      } catch {
        // Ignore individual file failures and keep going.
      }
    }

    setMetaValue(db, PROMPTS_LAST_CHECKED_KEY, new Date().toISOString());
  } catch {
    // If GitHub is unreachable, skip silently.
  }
}

function ensurePromptsDirectory(): string {
  const promptsDirectory = join(getHiveHomeDir(), "prompts");
  if (!existsSync(promptsDirectory)) {
    mkdirSync(promptsDirectory, { recursive: true });
  }
  return promptsDirectory;
}

function safeReadDirFiles(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function extractMarkdownFilenames(listingBody: string): string[] {
  const matches = new Set<string>();

  // Github directory listing pages typically contain repeated `prompts/<file>.md` segments.
  const pattern = /prompts\/([A-Za-z0-9._-]+\.md)\b/g;
  for (const match of listingBody.matchAll(pattern)) {
    if (match[1]) {
      matches.add(match[1]);
    }
  }

  return [...matches].sort((a, b) => a.localeCompare(b));
}
