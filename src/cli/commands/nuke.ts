import * as fs from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { Command } from "commander";
import keytar from "keytar";

import { SUPPORTED_PROVIDER_NAMES } from "../../providers/base.js";
import { getHiveHomeDir } from "../../storage/db.js";
import {
  renderError,
  renderHiveHeader,
  renderInfo,
  renderSuccess,
} from "../ui.js";

const KEYCHAIN_SERVICE = "hive";
const NUKE_CONFIRMATION = "nuke";

export function registerNukeCommand(program: Command): void {
  program
    .command("nuke")
    .description("Permanently delete your local Hive data and keys")
    .action(async () => {
      await runNukeCommand();
    });
}

export async function runNukeCommand(): Promise<void> {
  renderHiveHeader();
  renderError(
    "This will permanently delete your agent, all memory, all conversations, and all keys. This cannot be undone.",
  );

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  let confirmation = "";
  try {
    confirmation = (await rl.question('Are you sure? Type "nuke" to confirm: ')).trim();
  } finally {
    rl.close();
  }

  if (confirmation !== NUKE_CONFIRMATION) {
    renderInfo("Aborted.");
    return;
  }

  fs.rmSync(getHiveHomeDir(), { recursive: true, force: true });

  for (const providerName of SUPPORTED_PROVIDER_NAMES) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, providerName);
    } catch {
      // Missing or inaccessible keychain entries are non-fatal for nuke.
    }
  }

  renderSuccess("The Hive has been nuked. Gone.");
}
