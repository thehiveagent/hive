#!/usr/bin/env node

import "dotenv/config";

import chalk from "chalk";
import { Command } from "commander";

import { registerChatCommand } from "./commands/chat.js";
import { registerInitCommand } from "./commands/init.js";

const program = new Command();

program
  .name("hive")
  .description("Your agent. Always running. Always learning. Always working.")
  .version("0.1.0");

registerInitCommand(program);
registerChatCommand(program);

program
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
      process.exitCode = 1;
      return;
    }

    console.error(chalk.red(String(error)));
    process.exitCode = 1;
  });
