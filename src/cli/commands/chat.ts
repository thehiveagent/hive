import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import chalk from "chalk";
import { Command } from "commander";

import { HiveAgent } from "../../agent/agent.js";
import {
  closeHiveDatabase,
  getPrimaryAgent,
  openHiveDatabase,
} from "../../storage/db.js";
import { createProvider } from "../../providers/index.js";

interface ChatCommandOptions {
  message?: string;
  conversation?: string;
  model?: string;
  title?: string;
  temperature?: string;
}

interface RunChatOptions {
  model?: string;
  title?: string;
  temperature?: number;
}

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Talk to your Hive agent")
    .option("-m, --message <text>", "send a single message and exit")
    .option("-c, --conversation <id>", "continue an existing conversation")
    .option("--model <model>", "override model for this session")
    .option("--title <title>", "title for a newly created conversation")
    .option("-t, --temperature <value>", "sampling temperature")
    .action(async (options: ChatCommandOptions) => {
      await runChatCommand(options);
    });
}

export async function runChatCommand(options: ChatCommandOptions): Promise<void> {
  const temperature = parseTemperature(options.temperature);
  const db = openHiveDatabase();

  try {
    const profile = getPrimaryAgent(db);
    if (!profile) {
      console.error(chalk.red("Hive is not initialized. Run `hive init` first."));
      return;
    }

    const provider = createProvider(profile.provider);
    const agent = new HiveAgent(db, provider, profile);

    let conversationId = options.conversation;
    const runOptions: RunChatOptions = {
      model: options.model,
      title: options.title,
      temperature,
    };

    if (options.message) {
      conversationId = await streamReply(
        agent,
        options.message,
        conversationId,
        runOptions,
      );
      console.log(chalk.dim(`conversation: ${conversationId}`));
      return;
    }

    const rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    console.log(chalk.dim("Type /exit to quit, /new to start a fresh conversation."));

    try {
      while (true) {
        const prompt = (await rl.question(chalk.cyan("you> "))).trim();

        if (prompt.length === 0) {
          continue;
        }

        if (prompt === "/exit" || prompt === "/quit") {
          break;
        }

        if (prompt === "/new") {
          conversationId = undefined;
          console.log(chalk.dim("Started a new conversation context."));
          continue;
        }

        try {
          conversationId = await streamReply(agent, prompt, conversationId, runOptions);
        } catch (error) {
          process.stdout.write("\n");
          console.error(formatError(error));
        }
      }
    } finally {
      rl.close();
    }
  } finally {
    closeHiveDatabase(db);
  }
}

async function streamReply(
  agent: HiveAgent,
  prompt: string,
  conversationId: string | undefined,
  options: RunChatOptions,
): Promise<string> {
  process.stdout.write(chalk.green("hive> "));

  let activeConversationId = conversationId;

  for await (const event of agent.chat(prompt, {
    conversationId: activeConversationId,
    model: options.model,
    temperature: options.temperature,
    title: options.title,
  })) {
    if (event.type === "token") {
      process.stdout.write(event.token);
      activeConversationId = event.conversationId;
      continue;
    }

    activeConversationId = event.conversationId;
  }

  process.stdout.write("\n");

  if (!activeConversationId) {
    throw new Error("Conversation state was not returned by the agent.");
  }

  return activeConversationId;
}

function parseTemperature(raw?: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
    throw new Error("Temperature must be a number between 0 and 2.");
  }

  return parsed;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return chalk.red(error.message);
  }

  return chalk.red(String(error));
}
