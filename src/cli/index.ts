#!/usr/bin/env node

import "dotenv/config";

import { Command } from "commander";

import { registerChatCommand, runChatCommand } from "./commands/chat.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerNukeCommand } from "./commands/nuke.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerIntegrationsCommand } from "./commands/integrations.js";
import { getLocalVersion } from "./helpers/version.js";
import { renderError, renderHiveHeader } from "./ui.js";
import { printBanner } from "../ui/banner.js";

const program = new Command();

program
  .name("hive")
  .description("Your agent. Always running. Always learning. Always working.")
  .version(getLocalVersion());

registerInitCommand(program);
registerChatCommand(program);
registerConfigCommand(program);
registerDaemonCommand(program);
registerDoctorCommand(program);
registerStatusCommand(program);
registerNukeCommand(program);
registerMemoryCommand(program);
registerUpdateCommand(program);
registerTaskCommand(program);
registerIntegrationsCommand(program);

const argv = process.argv.slice(2);

void main();

async function main(): Promise<void> {
  try {
    if (argv.length === 0) {
      printBanner();
      await runChatCommand({}, { entrypoint: "default" });
      return;
    }

    if (shouldRenderHelpHeader(argv)) {
      renderHiveHeader(resolveHelpTitle(argv));
    }

    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      renderError(error.message);
      process.exitCode = 1;
      return;
    }

    renderError(String(error));
    process.exitCode = 1;
  }
}

function shouldRenderHelpHeader(args: string[]): boolean {
  return args[0] === "help" || args.includes("-h") || args.includes("--help");
}

function resolveHelpTitle(args: string[]): string {
  if (args[0] === "help") {
    return args[1] ?? "Help";
  }

  const commandName = args.find((arg) => !arg.startsWith("-"));
  return commandName ?? "Help";
}
