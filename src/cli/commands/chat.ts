import { stdin, stdout } from "node:process";
import * as readline from "node:readline";
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
import {
  runConfigKeyCommandWithOptions,
  runConfigModelCommandWithOptions,
  runConfigProviderCommandWithOptions,
  runConfigShowCommandWithOptions,
  runConfigThemeCommandWithOptions,
} from "./config.js";
import { runStatusCommandWithOptions } from "./status.js";
import { getTheme } from "../theme.js";

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

interface RunChatCommandContext {
  entrypoint?: "default" | "chat-command";
}

interface CommandSuggestion {
  label: string;
  insertText: string;
  description: string;
}

type HiveShortcutResult = "not-handled" | "handled" | "config-updated";

const PROMPT_SYMBOL = "›";
const USER_PROMPT = `you${PROMPT_SYMBOL} `;
const HIVE_SHORTCUT_PREFIX = "/hive";
const MAX_COMMAND_SUGGESTIONS = 8;
const COMMAND_LABEL_WIDTH = 24;
const COMMAND_HELP_TEXT = [
  "Commands:",
  "  /help           show commands",
  "  /new            start a new conversation",
  "  /browse <url>   read a webpage",
  "  browse <url>    same as /browse",
  "  /search <query> search the web",
  "  search <query>  same as /search",
  "  /hive help      show Hive command shortcuts",
  "  /hive status    run `hive status`",
  "  /hive config show run `hive config show`",
  "  /hive config provider interactive provider setup",
  "  /hive config model interactive model setup",
  "  /hive config key interactive key setup",
  "  /hive config theme interactive theme setup",
  "  /exit           quit",
].join("\n");
const HIVE_SHORTCUT_HELP_TEXT = [
  "Hive shortcuts:",
  "  /hive help         list shortcuts",
  "  /hive status       run hive status",
  "  /hive config show  run hive config show",
  "",
  "Interactive config commands (in chat):",
  "  /hive config provider",
  "  /hive config model",
  "  /hive config key",
  "  /hive config theme",
  "",
  "Safety commands still run from shell:",
  "  /hive init",
  "  /hive nuke",
].join("\n");
const CHAT_HINT_TEXT = "? for help | /exit to quit";
const EXCHANGE_SEPARATOR = "────";
const PREVIEW_AGENT_NAME = "jarvis";
const PREVIEW_PROVIDER = "google";
const PREVIEW_MODEL = "gemini-2.0-flash";
const PREVIEW_NEW_MESSAGE = "Started a new preview conversation context.";
const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  {
    label: "/help",
    insertText: "/help",
    description: "show chat commands",
  },
  {
    label: "/new",
    insertText: "/new",
    description: "start a new conversation",
  },
  {
    label: "/browse <url>",
    insertText: "/browse ",
    description: "read a webpage",
  },
  {
    label: "/search <query>",
    insertText: "/search ",
    description: "search the web",
  },
  {
    label: "/exit",
    insertText: "/exit",
    description: "quit chat",
  },
  {
    label: "/hive help",
    insertText: "/hive help",
    description: "show Hive command shortcuts",
  },
  {
    label: "/hive status",
    insertText: "/hive status",
    description: "run hive status",
  },
  {
    label: "/hive config show",
    insertText: "/hive config show",
    description: "run hive config show",
  },
  {
    label: "/hive init",
    insertText: "/hive init",
    description: "run hive init (outside chat)",
  },
  {
    label: "/hive config provider",
    insertText: "/hive config provider",
    description: "interactive provider setup",
  },
  {
    label: "/hive config model",
    insertText: "/hive config model",
    description: "interactive model setup",
  },
  {
    label: "/hive config key",
    insertText: "/hive config key",
    description: "interactive key setup",
  },
  {
    label: "/hive config theme",
    insertText: "/hive config theme",
    description: "interactive theme setup",
  },
  {
    label: "/hive nuke",
    insertText: "/hive nuke",
    description: "run hive nuke (outside chat)",
  },
];

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("(Deprecated) Talk to your Hive agent. Use `hive`.")
    .option("-m, --message <text>", "send a single message and exit")
    .option("-c, --conversation <id>", "continue an existing conversation")
    .option("--model <model>", "override model for this session")
    .option("--title <title>", "title for a newly created conversation")
    .option("-t, --temperature <value>", "sampling temperature")
    .option("--preview", "run chat UI preview without Hive initialization")
    .action(async (options: ChatCommandOptions) => {
      await runChatCommand(options, { entrypoint: "chat-command" });
    });
}

export async function runChatCommand(
  options: ChatCommandOptions,
  context: RunChatCommandContext = {},
): Promise<void> {
  console.clear();
  renderHiveHeader("Chat");

  const entrypoint = context.entrypoint ?? "chat-command";
  if (entrypoint === "chat-command") {
    renderInfo("`hive chat` is deprecated. Run `hive`.");
  }

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

    let activeProfile = profile;
    let provider = await createProvider(activeProfile.provider);
    let agent = new HiveAgent(db, provider, activeProfile);
    let agentName = resolveAgentName(activeProfile.agent_name);
    const model = options.model ?? activeProfile.model;

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

    while (true) {
      const prompt = await readPromptWithSuggestions();

      if (prompt.length === 0) {
        continue;
      }

      if (prompt === "/") {
        printChatHelp();
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
        const shortcutResult = await handleHiveShortcut(prompt, {
          allowInteractiveConfig: true,
        });
        if (shortcutResult === "handled") {
          continue;
        }
        if (shortcutResult === "config-updated") {
          const latestProfile = getPrimaryAgent(db);
          if (!latestProfile) {
            renderError("Hive is not initialized. Run `hive init` first.");
            continue;
          }

          activeProfile = latestProfile;
          provider = await createProvider(activeProfile.provider);
          agent = new HiveAgent(db, provider, activeProfile);
          agentName = resolveAgentName(activeProfile.agent_name);
          if (!options.model) {
            runOptions.model = activeProfile.model;
          }

          conversationId = undefined;
          renderInfo(
            `Switched to ${activeProfile.provider} · ${runOptions.model ?? activeProfile.model}.`,
          );
          renderInfo("Started a new conversation context.");
          continue;
        }

        if (isUnknownSlashCommand(prompt)) {
          renderError(`Unknown command: ${prompt}`);
          renderInfo("Run `/help` to view supported commands.");
          continue;
        }

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
  process.stdout.write(getTheme().accent(`${agentName}${PROMPT_SYMBOL} `));

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

  while (true) {
    const prompt = await readPromptWithSuggestions();

    if (prompt.length === 0) {
      continue;
    }

    if (prompt === "/") {
      printChatHelp();
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

    if (isHiveShortcut(prompt)) {
      renderInfo("Hive shortcuts are unavailable in preview mode.");
      continue;
    }

    if (isUnknownSlashCommand(prompt)) {
      renderError(`Unknown command: ${prompt}`);
      renderInfo("Run `/help` to view supported commands.");
      continue;
    }

    await streamPreviewReply(prompt, agentName);
  }
}

async function streamPreviewReply(prompt: string, agentName: string): Promise<void> {
  const response = `preview mode: received "${prompt}"`;
  process.stdout.write(getTheme().accent(`${agentName}${PROMPT_SYMBOL} `));
  process.stdout.write(response);
  process.stdout.write("\n");
  renderSeparator(EXCHANGE_SEPARATOR);
}

function isHiveShortcut(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return normalized === HIVE_SHORTCUT_PREFIX || normalized.startsWith(`${HIVE_SHORTCUT_PREFIX} `);
}

function isUnknownSlashCommand(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized.startsWith("/")) {
    return false;
  }

  if (
    normalized === "/help" ||
    normalized === "/new" ||
    normalized === "/exit" ||
    normalized === "/quit" ||
    normalized === "/browse" ||
    normalized.startsWith("/browse ") ||
    normalized === "/search" ||
    normalized.startsWith("/search ") ||
    normalized === HIVE_SHORTCUT_PREFIX ||
    normalized.startsWith(`${HIVE_SHORTCUT_PREFIX} `)
  ) {
    return false;
  }

  return true;
}

async function handleHiveShortcut(
  prompt: string,
  options: {
    allowInteractiveConfig?: boolean;
  } = {},
): Promise<HiveShortcutResult> {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();

  if (lower === HIVE_SHORTCUT_PREFIX) {
    renderInfo(HIVE_SHORTCUT_HELP_TEXT);
    return "handled";
  }

  if (!lower.startsWith(`${HIVE_SHORTCUT_PREFIX} `)) {
    return "not-handled";
  }

  const rawSubcommand = normalized.slice(HIVE_SHORTCUT_PREFIX.length).trim();
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand.length === 0 || subcommand === "help") {
    renderInfo(HIVE_SHORTCUT_HELP_TEXT);
    return "handled";
  }

  if (subcommand === "status") {
    await runStatusCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "handled";
  }

  if (subcommand === "config show") {
    await runConfigShowCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "handled";
  }

  if (subcommand === "config provider") {
    if (!options.allowInteractiveConfig) {
      renderInfo("Interactive config commands are unavailable here.");
      return "handled";
    }

    await runConfigProviderCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "config-updated";
  }

  if (subcommand === "config model") {
    if (!options.allowInteractiveConfig) {
      renderInfo("Interactive config commands are unavailable here.");
      return "handled";
    }

    await runConfigModelCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "config-updated";
  }

  if (subcommand === "config key") {
    if (!options.allowInteractiveConfig) {
      renderInfo("Interactive config commands are unavailable here.");
      return "handled";
    }

    await runConfigKeyCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "handled";
  }

  if (subcommand === "config theme") {
    if (!options.allowInteractiveConfig) {
      renderInfo("Interactive config commands are unavailable here.");
      return "handled";
    }

    await runConfigThemeCommandWithOptions({ showHeader: false });
    restoreChatInputAfterInteractiveCommand();
    return "handled";
  }

  if (
    subcommand === "init" ||
    subcommand === "nuke"
  ) {
    renderInfo(`Run \`hive ${rawSubcommand}\` from your shell. This command is interactive.`);
    return "handled";
  }

  renderError(`Unknown Hive shortcut: /hive ${rawSubcommand}`);
  renderInfo("Use `/hive help` to list available shortcuts.");
  return "handled";
}

function getCommandSuggestions(input: string): CommandSuggestion[] {
  const normalized = input.trimStart().toLowerCase();
  if (!normalized.startsWith("/")) {
    return [];
  }

  const prefixMatches = COMMAND_SUGGESTIONS.filter(
    (suggestion) =>
      suggestion.insertText.toLowerCase().startsWith(normalized) ||
      suggestion.label.toLowerCase().startsWith(normalized),
  );

  const fallbackMatches = COMMAND_SUGGESTIONS.filter(
    (suggestion) =>
      !prefixMatches.includes(suggestion) &&
      suggestion.label.toLowerCase().includes(normalized.slice(1)),
  );

  return [...prefixMatches, ...fallbackMatches];
}

async function readPromptWithSuggestions(): Promise<string> {
  const accent = getTheme().accent;
  const promptPrefix = accent(USER_PROMPT);

  if (!stdin.isTTY || !stdout.isTTY) {
    const rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    try {
      return (await rl.question(promptPrefix)).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve) => {
    stdin.resume();
    readline.emitKeypressEvents(stdin);

    const wasRaw = stdin.isRaw ?? false;
    if (!wasRaw) {
      stdin.setRawMode(true);
    }

    let buffer = "";
    let selectedSuggestionIndex = 0;
    let suggestionWindowStart = 0;
    let renderedSuggestionRows = 0;

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (!wasRaw) {
        stdin.setRawMode(false);
      }
    };

    const commit = () => {
      const suggestions = getCommandSuggestions(buffer);
      const selected = suggestions[selectedSuggestionIndex];
      let value = buffer.trim();

      if (
        selected &&
        value.startsWith("/") &&
        (value === "/" ||
          selected.insertText.toLowerCase().startsWith(value.toLowerCase()) ||
          selected.label.toLowerCase().startsWith(value.toLowerCase()))
      ) {
        value = selected.insertText.trimEnd();
      }

      if (value === "/") {
        value = "/help";
      }

      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(`${promptPrefix}${buffer}`);

      for (let index = 0; index < renderedSuggestionRows; index += 1) {
        readline.moveCursor(stdout, 0, 1);
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);
      }

      for (let index = 0; index < renderedSuggestionRows; index += 1) {
        readline.moveCursor(stdout, 0, -1);
      }

      renderedSuggestionRows = 0;
      readline.cursorTo(stdout, USER_PROMPT.length + buffer.length);
      stdout.write("\n");
      cleanup();
      resolve(value);
    };

    const render = () => {
      const suggestions = getCommandSuggestions(buffer);
      if (selectedSuggestionIndex >= suggestions.length) {
        selectedSuggestionIndex = Math.max(0, suggestions.length - 1);
      }
      if (suggestions.length === 0) {
        suggestionWindowStart = 0;
      }

      const visibleSuggestionCount = Math.min(MAX_COMMAND_SUGGESTIONS, suggestions.length);
      if (selectedSuggestionIndex < suggestionWindowStart) {
        suggestionWindowStart = selectedSuggestionIndex;
      }
      if (
        visibleSuggestionCount > 0 &&
        selectedSuggestionIndex >= suggestionWindowStart + visibleSuggestionCount
      ) {
        suggestionWindowStart = selectedSuggestionIndex - visibleSuggestionCount + 1;
      }

      const visibleSuggestions = suggestions.slice(
        suggestionWindowStart,
        suggestionWindowStart + visibleSuggestionCount,
      );

      readline.cursorTo(stdout, 0);
      readline.clearLine(stdout, 0);
      stdout.write(`${promptPrefix}${buffer}`);

      const rowsToRender = Math.max(renderedSuggestionRows, visibleSuggestions.length);
      for (let index = 0; index < rowsToRender; index += 1) {
        readline.moveCursor(stdout, 0, 1);
        readline.cursorTo(stdout, 0);
        readline.clearLine(stdout, 0);

        if (index >= visibleSuggestions.length) {
          continue;
        }

        const suggestion = visibleSuggestions[index];
        const absoluteIndex = suggestionWindowStart + index;
        const marker = absoluteIndex === selectedSuggestionIndex ? ">" : " ";
        const label = suggestion.label.padEnd(COMMAND_LABEL_WIDTH, " ");
        const text = `${marker} ${label} ${suggestion.description}`;

        if (absoluteIndex === selectedSuggestionIndex) {
          stdout.write(accent(text));
        } else {
          stdout.write(chalk.dim(text));
        }
      }

      for (let index = 0; index < rowsToRender; index += 1) {
        readline.moveCursor(stdout, 0, -1);
      }

      readline.cursorTo(stdout, USER_PROMPT.length + buffer.length);
      renderedSuggestionRows = visibleSuggestions.length;
    };

    const onKeypress = (str: string, key: readline.Key) => {
      if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "d")) {
        buffer = "/exit";
        commit();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const suggestions = getCommandSuggestions(buffer);
        const selected = suggestions[selectedSuggestionIndex];
        const trimmed = buffer.trim();

        if (
          selected &&
          trimmed.startsWith("/") &&
          (trimmed === "/" ||
            selected.insertText.toLowerCase().startsWith(trimmed.toLowerCase()) ||
            selected.label.toLowerCase().startsWith(trimmed.toLowerCase()))
        ) {
          buffer = selected.insertText;
          selectedSuggestionIndex = 0;
          suggestionWindowStart = 0;

          // Commands that expect extra input should stay in edit mode.
          if (buffer.endsWith(" ")) {
            render();
            return;
          }
        }

        commit();
        return;
      }

      if (key.name === "backspace") {
        const chars = Array.from(buffer);
        chars.pop();
        buffer = chars.join("");
        selectedSuggestionIndex = 0;
        suggestionWindowStart = 0;
        render();
        return;
      }

      if (key.name === "up" || key.name === "down") {
        const suggestions = getCommandSuggestions(buffer);
        if (suggestions.length === 0) {
          return;
        }

        if (key.name === "up") {
          selectedSuggestionIndex =
            selectedSuggestionIndex > 0
              ? selectedSuggestionIndex - 1
              : suggestions.length - 1;
        } else {
          selectedSuggestionIndex =
            selectedSuggestionIndex < suggestions.length - 1
              ? selectedSuggestionIndex + 1
              : 0;
        }

        render();
        return;
      }

      if (key.name === "tab") {
        const suggestions = getCommandSuggestions(buffer);
        if (suggestions.length === 0) {
          return;
        }

        buffer = suggestions[selectedSuggestionIndex]?.insertText ?? buffer;
        selectedSuggestionIndex = 0;
        suggestionWindowStart = 0;
        render();
        return;
      }

      if (typeof str === "string" && str.length > 0 && !key.ctrl && !key.meta) {
        buffer += str;
        selectedSuggestionIndex = 0;
        suggestionWindowStart = 0;
        render();
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

function restoreChatInputAfterInteractiveCommand(): void {
  if (!stdin.isTTY) {
    return;
  }

  try {
    stdin.setRawMode(false);
  } catch {
    // Ignore terminal mode recovery errors.
  }

  stdin.resume();
}
