import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import chalk from "chalk";
import { Command } from "commander";

import { maybeAutoUpdatePromptsOnBoot } from "../../agent/prompt-auto-update.js";
import { initializeHiveCtxSession, type HiveCtxSession } from "../../agent/hive-ctx.js";
import {
  closeHiveDatabase,
  getHiveHomeDir,
  getPrimaryAgent,
  openHiveDatabase,
} from "../../storage/db.js";
import { renderError, renderHiveHeader, renderInfo, renderSuccess } from "../ui.js";
import { fetchLatestVersion, getLocalVersion, isVersionNewer } from "../helpers/version.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update Hive CLI to the latest version")
    .action(async () => {
      await runUpdateCommand();
    });
}

export async function runUpdateCommand(): Promise<void> {
  renderHiveHeader("Update");

  const localVersion = getLocalVersion();
  const latestVersion = await fetchLatestVersion();

  if (!latestVersion) {
    renderError("Could not check for updates right now. Try again later.");
    return;
  }

  if (!isVersionNewer(latestVersion, localVersion)) {
    renderSuccess(`✓ You're on the latest version (v${localVersion})`);
    return;
  }

  renderInfo(chalk.dim(`What's new: v${localVersion} → v${latestVersion}`));
  const updated = await runNpmGlobalUpdate(latestVersion);
  if (!updated) {
    renderError("Update failed. Please run `npm update -g @imisbahk/hive` manually.");
    return;
  }

  await runPromptSyncAndWarmup();

  renderSuccess("✓ Hive is up to date and ready.");
}

async function runPromptSyncAndWarmup(): Promise<void> {
  const db = openHiveDatabase();

  try {
    const agent = getPrimaryAgent(db);
    if (!agent) {
      renderInfo(chalk.dim("Hive is not initialized yet; skipping prompt sync and warmup."));
      return;
    }

    await maybeAutoUpdatePromptsOnBoot(db, (message) => {
      renderInfo(chalk.dim(message));
    });

    const ctxStoragePath = join(getHiveHomeDir(), "ctx");
    mkdirSync(ctxStoragePath, { recursive: true });
    const hiveCtx = await initializeHiveCtxSession({
      storagePath: ctxStoragePath,
      profile: agent,
      model: agent.model,
    });

    if (hiveCtx.warning) {
      renderInfo(chalk.dim(hiveCtx.warning));
    }

    await warmupCtx(hiveCtx.session);
  } finally {
    closeHiveDatabase(db);
  }
}

async function warmupCtx(session: HiveCtxSession | null): Promise<void> {
  if (!session) {
    return;
  }

  try {
    await session.build("warmup");
    renderInfo(chalk.dim("Hive context cache warmed."));
  } catch (error) {
    renderInfo(chalk.dim(`Hive context warmup skipped: ${String(error)}`));
  }
}

async function runNpmGlobalUpdate(latestVersion: string): Promise<boolean> {
  renderInfo(`Updating to v${latestVersion}...`);

  return new Promise<boolean>((resolve) => {
    const child = spawn("npm", ["update", "-g", "@imisbahk/hive"], {
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        renderSuccess(`Updated to v${latestVersion}.`);
        resolve(true);
      } else {
        resolve(false);
      }
    });

    child.on("error", () => resolve(false));
  });
}
