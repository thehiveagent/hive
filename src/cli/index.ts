#!/usr/bin/env node

import "dotenv/config";

import { Command } from "commander";

import { registerChatCommand } from "./commands/chat.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerInitCommand } from "./commands/init.js";
import { registerNukeCommand } from "./commands/nuke.js";
import { registerStatusCommand } from "./commands/status.js";
import { renderError } from "./ui.js";

const program = new Command();

program
  .name("hive")
  .description("Your agent. Always running. Always learning. Always working.")
  .version("0.1.0");

registerInitCommand(program);
registerChatCommand(program);
registerConfigCommand(program);
registerStatusCommand(program);
registerNukeCommand(program);

program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    if (error instanceof Error) {
      renderError(error.message);
      process.exitCode = 1;
      return;
    }

    renderError(String(error));
    process.exitCode = 1;
  });
