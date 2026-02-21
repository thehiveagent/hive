import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import chalk from "chalk";
import { Command } from "commander";

import { buildBrowserAugmentedPrompt, HiveAgent } from "../../agent/agent.js";
import {
  closeHiveDatabase,
  getPrimaryAgent,
  openHiveDatabase,
} from "../../storage/db.js";
import { createProvider } from "../../providers/index.js";
import {
  renderError,
  renderHiveHeader,
  renderInfo,
  renderSeparator,
} from "../ui.js";

interface ChatCommandOptions {
  message?: string;
  conversation?: string;
  model?: string;
  title?: string;
  temperature?: string;
  preview?: boolean;
}

interface RunChatOptions {
  model?: string;
  title?: string;
  temperature?: number;
}

const USER_PROMPT = "you› ";
const COMMAND_HELP_TEXT = [
  "Commands:",
  "  /help           show commands",
  "  /new            start a new conversation",
  "  /browse <url>   read a webpage",
  "  browse <url>    same as /browse",
  "  /search <query> search the web",
  "  search <query>  same as /search",
  "  /exit           quit",
].join("\n");
const CHAT_HINT_TEXT = "? for help | /exit to quit";
const EXCHANGE_SEPARATOR = "────";
const PREVIEW_AGENT_NAME = "jarvis";
const PREVIEW_PROVIDER = "google";
const PREVIEW_MODEL = "gemini-2.0-flash";
const PREVIEW_NEW_MESSAGE = "Started a new preview conversation context.";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Talk to your Hive agent")
    .option("-m, --message <text>", "send a single message and exit")
    .option("-c, --conversation <id>", "continue an existing conversation")
    .option("--model <model>", "override model for this session")
    .option("--title <title>", "title for a newly created conversation")
    .option("-t, --temperature <value>", "sampling temperature")
    .option("--preview", "run chat UI preview without Hive initialization")
    .action(async (options: ChatCommandOptions) => {
      await runChatCommand(options);
    });
}

export async function runChatCommand(options: ChatCommandOptions): Promise<void> {
  console.clear();
  renderHiveHeader("Chat");

  if (options.preview) {
    await runPreviewSession(options);
    return;
  }

  const temperature = parseTemperature(options.temperature);
  const db = openHiveDatabase();

  try {
    const profile = getPrimaryAgent(db);
    if (!profile) {
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const provider = await createProvider(profile.provider);
    const agent = new HiveAgent(db, provider, profile);
    const agentName = resolveAgentName(profile.agent_name);
    const model = options.model ?? profile.model;

    let conversationId = options.conversation;
    const runOptions: RunChatOptions = {
      model,
      title: options.title,
      temperature,
    };

    renderChatPreamble({
      agentName,
      provider: profile.provider,
      model,
    });

    if (options.message) {
      const augmentedMessage = await buildBrowserAugmentedPrompt(options.message, {
        locationHint: profile.location ?? undefined,
      });
      conversationId = await streamReply(
        agent,
        augmentedMessage,
        conversationId,
        runOptions,
        agentName,
      );
      renderInfo(`conversation: ${conversationId}`);
      return;
    }

    const rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    try {
      while (true) {
        const prompt = (await rl.question(chalk.whiteBright(USER_PROMPT))).trim();

        if (prompt.length === 0) {
          continue;
        }

        if (prompt === "/help") {
          printChatHelp();
          continue;
        }

        if (prompt === "/exit" || prompt === "/quit") {
          break;
        }

        if (prompt === "/new") {
          conversationId = undefined;
          renderInfo("Started a new conversation context.");
          continue;
        }

        try {
          const augmentedPrompt = await buildBrowserAugmentedPrompt(prompt, {
            locationHint: profile.location ?? undefined,
          });
          conversationId = await streamReply(
            agent,
            augmentedPrompt,
            conversationId,
            runOptions,
            agentName,
          );
        } catch (error) {
          renderError(formatError(error));
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
  agentName: string,
): Promise<string> {
  process.stdout.write(chalk.whiteBright(`${agentName}› `));

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
  renderSeparator(EXCHANGE_SEPARATOR);

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
    return error.message;
  }

  return String(error);
}

function resolveAgentName(agentName: string | null | undefined): string {
  const normalized = agentName?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return "hive";
}

function renderChatPreamble(input: {
  agentName: string;
  provider: string;
  model: string;
}): void {
  renderInfo(`${input.agentName} · ${input.provider} · ${input.model}`);
  renderInfo(CHAT_HINT_TEXT);
}

function printChatHelp(): void {
  renderInfo(COMMAND_HELP_TEXT);
}

async function runPreviewSession(options: ChatCommandOptions): Promise<void> {
  const model = options.model ?? PREVIEW_MODEL;
  const agentName = PREVIEW_AGENT_NAME;

  renderChatPreamble({
    agentName,
    provider: PREVIEW_PROVIDER,
    model,
  });

  if (options.message) {
    await streamPreviewReply(options.message, agentName);
    return;
  }

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  try {
    while (true) {
      const prompt = (await rl.question(chalk.whiteBright(USER_PROMPT))).trim();

      if (prompt.length === 0) {
        continue;
      }

      if (prompt === "/help") {
        printChatHelp();
        continue;
      }

      if (prompt === "/exit" || prompt === "/quit") {
        break;
      }

      if (prompt === "/new") {
        renderInfo(PREVIEW_NEW_MESSAGE);
        continue;
      }

      await streamPreviewReply(prompt, agentName);
    }
  } finally {
    rl.close();
  }
}

async function streamPreviewReply(prompt: string, agentName: string): Promise<void> {
  const response = `preview mode: received "${prompt}"`;
  process.stdout.write(chalk.whiteBright(`${agentName}› `));
  process.stdout.write(response);
  process.stdout.write("\n");
  renderSeparator(EXCHANGE_SEPARATOR);
}
