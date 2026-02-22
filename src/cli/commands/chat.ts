import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import * as readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

import chalk from "chalk";
import { Command } from "commander";
import fetch from "node-fetch";
import type { Provider, ProviderMessage } from "../../providers/base.js";

import {
  RUNTIME_SYSTEM_GUARDRAILS,
  buildBrowserAugmentedPrompt,
  HiveAgent,
} from "../../agent/agent.js";
import {
  closeHiveDatabase,
  deleteKnowledge,
  findClosestKnowledge,
  type HiveDatabase,
  getPrimaryAgent,
  getHiveHomeDir,
  insertKnowledge,
  insertEpisode,
  listPinnedKnowledge,
  listKnowledge,
  findRelevantEpisodes,
  type KnowledgeRecord,
  type MessageRecord,
  listConversationMessages,
  listRecentConversations,
  openHiveDatabase,
  updateConversationTitle,
} from "../../storage/db.js";
import { createProvider } from "../../providers/index.js";
import {
  renderError,
  renderHiveHeader,
  renderInfo,
  renderSeparator,
  renderSuccess,
} from "../ui.js";
import { openPage } from "../../browser/browser.js";
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
type ModeName = "default" | "research" | "code" | "brainstorm" | "brief";

const PROMPT_SYMBOL = "›";
const USER_PROMPT = `you${PROMPT_SYMBOL} `;
const HIVE_SHORTCUT_PREFIX = "/hive";
const MAX_COMMAND_SUGGESTIONS = 8;
const COMMAND_LABEL_WIDTH = 24;
const COMMAND_HELP_TEXT = [
  "Commands:",
  "  /help           show commands",
  "  /new            start a new conversation",
  "  /remember <fact> save a fact",
  "  /forget <thing>  delete closest fact",
  "  /pin <fact>      pin fact into context",
  "  /summarize <url> summarize a web page",
  "  /tldr            summarize this conversation",
  "  /recap           summarize persona + knowledge",
  "  /mode <name>     switch response mode",
  "  /status          show mode/provider/model",
  "  /export          export conversation markdown",
  "  /save <title>    name this conversation",
  "  /history         list recent conversations",
  "  /clear           clear the screen",
  "  /think <question>think step by step",
  "  /retry           resend last message",
  "  /copy            copy last reply",
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
const MODE_PROMPTS: Record<ModeName, string | null> = {
  default: null,
  research:
    "Every answer must be grounded in current web evidence. Perform web search as needed and cite sources inline.",
  code: "Think and respond like a focused software engineer. Prioritize concise technical answers and code.",
  brainstorm:
    "Be creative and opinionated. Offer bold suggestions and push back on weak ideas when helpful.",
  brief: "Keep every response to a maximum of 3 sentences while preserving key details.",
};
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
    label: "/remember <fact>",
    insertText: "/remember ",
    description: "save to knowledge graph",
  },
  {
    label: "/pin <fact>",
    insertText: "/pin ",
    description: "pin fact into context",
  },
  {
    label: "/forget <thing>",
    insertText: "/forget ",
    description: "delete closest fact",
  },
  {
    label: "/summarize <url>",
    insertText: "/summarize ",
    description: "summarize a web page",
  },
  {
    label: "/tldr",
    insertText: "/tldr",
    description: "summarize this conversation",
  },
  {
    label: "/recap",
    insertText: "/recap",
    description: "summarize persona & knowledge",
  },
  {
    label: "/mode <name>",
    insertText: "/mode ",
    description: "switch response style",
  },
  {
    label: "/export",
    insertText: "/export",
    description: "export conversation markdown",
  },
  {
    label: "/save <title>",
    insertText: "/save ",
    description: "set conversation title",
  },
  {
    label: "/history",
    insertText: "/history",
    description: "list recent conversations",
  },
  {
    label: "/status",
    insertText: "/status",
    description: "show session status",
  },
  {
    label: "/clear",
    insertText: "/clear",
    description: "clear the screen",
  },
  {
    label: "/think <question>",
    insertText: "/think ",
    description: "think step by step",
  },
  {
    label: "/retry",
    insertText: "/retry",
    description: "resend last message",
  },
  {
    label: "/copy",
    insertText: "/copy",
    description: "copy last reply",
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
  void checkForUpdates();

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
    let currentMode: ModeName = "default";
    const model = options.model ?? activeProfile.model;

    let conversationId = options.conversation;
    const runOptions: RunChatOptions = {
      model,
      title: options.title,
      temperature,
    };
    const lastUserPromptRef: { value: string | null } = { value: null };
    const lastAssistantRef: { value: string } = { value: "" };

    renderChatPreamble({
      agentName,
      provider: profile.provider,
      model,
    });

    if (options.message) {
      const augmentedMessage = await buildBrowserAugmentedPrompt(options.message, {
        locationHint: profile.location ?? undefined,
      });
      const memoryAddition = buildMemoryAddition(db, options.message);
      const systemAddition = combineSystemAdditions([
        getModeSystemPrompt(currentMode),
        memoryAddition,
      ]);
      lastUserPromptRef.value = options.message;
      const streamResult = await streamReply(
        agent,
        augmentedMessage,
        conversationId,
        runOptions,
        agentName,
        systemAddition,
      );
      conversationId = streamResult.conversationId;
      lastAssistantRef.value = streamResult.assistantText;
      saveEpisodeSummary(db, options.message, streamResult.assistantText);
      renderInfo(`conversation: ${conversationId}`);
      return;
    }

    while (true) {
      const prompt = await readPromptWithSuggestions();

      if (prompt.length === 0) {
        continue;
      }

      const normalizedPrompt = prompt.trim().toLowerCase();

      if (prompt === "/") {
        printChatHelp();
        continue;
      }

      if (normalizedPrompt === "/help") {
        printChatHelp();
        continue;
      }

      if (normalizedPrompt === "/exit" || normalizedPrompt === "/quit") {
        break;
      }

        if (normalizedPrompt === "/new") {
          conversationId = undefined;
          currentMode = "default";
          lastUserPromptRef.value = null;
          lastAssistantRef.value = "";
          renderInfo("Started a new conversation context.");
          continue;
        }

        try {
          const handled = await handleChatSlashCommand({
            prompt,
            db,
            agent,
            provider,
            agentName,
            conversationId,
            activeProfilePersona: activeProfile.persona,
            mode: currentMode,
            providerName: activeProfile.provider,
            modelName: runOptions.model ?? activeProfile.model,
            setConversationId: (id) => {
              conversationId = id;
            },
            setMode: (mode) => {
              currentMode = mode;
            },
            lastUserPromptRef,
            lastAssistantRef,
          });
          if (handled) {
            continue;
          }

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
            renderError("✗ Unknown command. Type /help for available commands.");
            continue;
          }

          const augmentedPrompt = await buildBrowserAugmentedPrompt(prompt, {
            locationHint: profile.location ?? undefined,
          });
          lastUserPromptRef.value = prompt;
          const memoryAddition = buildMemoryAddition(db, prompt);
          const systemAddition = combineSystemAdditions([
            getModeSystemPrompt(currentMode),
            memoryAddition,
          ]);

          const streamResult = await streamReply(
            agent,
            augmentedPrompt,
            conversationId,
            runOptions,
            agentName,
            systemAddition,
          );
          conversationId = streamResult.conversationId;
          lastAssistantRef.value = streamResult.assistantText;
          saveEpisodeSummary(db, prompt, streamResult.assistantText);
        } catch (error) {
          renderError(formatError(error));
        }
      }
  } finally {
    closeHiveDatabase(db);
  }
}

interface StreamResult {
  conversationId: string;
  assistantText: string;
}

async function streamReply(
  agent: HiveAgent,
  prompt: string,
  conversationId: string | undefined,
  options: RunChatOptions,
  agentName: string,
  systemAddition?: string,
): Promise<StreamResult> {
  process.stdout.write(getTheme().accent(`${agentName}${PROMPT_SYMBOL} `));

  let activeConversationId = conversationId;
  let assistantText = "";

  for await (const event of agent.chat(prompt, {
    conversationId: activeConversationId,
    model: options.model,
    temperature: options.temperature,
    title: options.title,
    systemAddition,
  })) {
    if (event.type === "token") {
      process.stdout.write(event.token);
      activeConversationId = event.conversationId;
      assistantText += event.token;
      continue;
    }

    activeConversationId = event.conversationId;
  }

  process.stdout.write("\n");
  renderSeparator(EXCHANGE_SEPARATOR);

  if (!activeConversationId) {
    throw new Error("Conversation state was not returned by the agent.");
  }

  return { conversationId: activeConversationId, assistantText };
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

function getModeSystemPrompt(mode: ModeName): string | undefined {
  return MODE_PROMPTS[mode] ?? undefined;
}

function combineSystemAdditions(parts: Array<string | undefined | null>): string | undefined {
  const merged = parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n\n");

  return merged.length > 0 ? merged : undefined;
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
    normalized === "/remember" ||
    normalized.startsWith("/remember ") ||
    normalized === "/forget" ||
    normalized.startsWith("/forget ") ||
    normalized === "/summarize" ||
    normalized.startsWith("/summarize ") ||
    normalized === "/tldr" ||
    normalized === "/recap" ||
    normalized === "/mode" ||
    normalized.startsWith("/mode ") ||
    normalized === "/export" ||
    normalized === "/history" ||
    normalized === "/clear" ||
    normalized === "/think" ||
    normalized.startsWith("/think ") ||
    normalized.startsWith("/save") ||
    normalized.startsWith("/pin") ||
    normalized === "/status" ||
    normalized === "/retry" ||
    normalized === "/copy" ||
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

async function handleChatSlashCommand(input: {
  prompt: string;
  db: HiveDatabase;
  agent: HiveAgent;
  provider: Provider;
  agentName: string;
  conversationId: string | undefined;
  activeProfilePersona: string;
  mode: ModeName;
  providerName: string;
  modelName: string;
  setConversationId: (id: string | undefined) => void;
  setMode: (mode: ModeName) => void;
  lastUserPromptRef: { value: string | null };
  lastAssistantRef: { value: string };
}): Promise<boolean> {
  const normalized = input.prompt.trim();
  const lower = normalized.toLowerCase();

  if (!lower.startsWith("/")) {
    return false;
  }

  if (lower === "/clear") {
    console.clear();
    renderHiveHeader("Chat");
    renderChatPreamble({
      agentName: input.agentName,
      provider: input.providerName,
      model: input.modelName,
    });
    input.lastUserPromptRef.value = null;
    input.lastAssistantRef.value = "";
    return true;
  }

  if (lower.startsWith("/remember")) {
    const fact = normalized.slice("/remember".length).trim();
    if (fact.length === 0) {
      renderError("Usage: /remember <fact>");
      return true;
    }

    insertKnowledge(input.db, { content: fact });
    renderSuccess("✓ Remembered.");
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower.startsWith("/forget")) {
    const query = normalized.slice("/forget".length).trim();
    if (query.length === 0) {
      renderError("Usage: /forget <thing>");
      return true;
    }

    const match = findClosestKnowledge(input.db, query);
    if (!match) {
      renderError("No similar knowledge found.");
      return true;
    }

    const confirmed = await promptYesNo(`Forget "${match.content}"? (y/n) `);
    if (!confirmed) {
      renderInfo("Kept.");
      return true;
    }

    deleteKnowledge(input.db, match.id);
    renderSuccess("✓ Forgotten.");
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower.startsWith("/mode")) {
    const modeName = normalized.slice("/mode".length).trim().toLowerCase();
    if (!modeName || !Object.hasOwn(MODE_PROMPTS, modeName)) {
      renderError("Usage: /mode <default|research|code|brainstorm|brief>");
      return true;
    }

    input.setMode(modeName as ModeName);
    renderSuccess(`✓ Mode set to ${modeName}.`);
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower.startsWith("/pin")) {
    const fact = normalized.slice("/pin".length).trim();
    if (fact.length === 0) {
      renderError("Usage: /pin <fact>");
      return true;
    }

    insertKnowledge(input.db, { content: fact, pinned: true });
    renderSuccess("✓ Pinned.");
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower === "/export") {
    if (!input.conversationId) {
      renderError("No conversation to export. Start chatting first.");
      return true;
    }

    const messages = listConversationMessages(input.db, input.conversationId);
    const exportDir = join(getHiveHomeDir(), "exports");
    mkdirSync(exportDir, { recursive: true });
    const exportPath = join(exportDir, `${input.conversationId}.md`);
    writeFileSync(exportPath, formatConversationMarkdown(messages, input.conversationId));
    renderSuccess(`✓ Exported to ${exportPath}`);
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower === "/history") {
    const rows = listRecentConversations(input.db, 10);
    if (rows.length === 0) {
      renderInfo("No past conversations found.");
      return true;
    }

    rows.forEach((row, index) => {
      const title = row.title?.trim().length ? row.title : "(untitled)";
      renderInfo(`${index + 1}. ${title} · ${row.updated_at} · ${row.message_count} messages`);
    });

    const answer = await promptLine("Pick a conversation number (or blank to cancel): ");
    if (!answer) {
      return true;
    }

    const choice = Number.parseInt(answer, 10);
    if (Number.isNaN(choice) || choice < 1 || choice > rows.length) {
      renderError("Invalid selection.");
      return true;
    }

    const selected = rows[choice - 1];
    input.setConversationId(selected.id);
    renderInfo(`Continuing conversation ${selected.title ?? selected.id}.`);
    input.lastUserPromptRef.value = null;
    input.lastAssistantRef.value = "";
    return true;
  }

  if (lower === "/tldr") {
    if (!input.conversationId) {
      renderError("No conversation yet. Say something first.");
      return true;
    }

    const history = listConversationMessages(input.db, input.conversationId);
    if (history.length === 0) {
      renderError("Nothing to summarize yet.");
      return true;
    }

    await streamEphemeral({
      provider: input.provider,
      agentName: input.agentName,
      model: input.modelName,
      messages: buildEphemeralMessages({
        persona: input.activeProfilePersona,
        mode: input.mode,
        systemInstruction: "Summarize this conversation in 3-5 bullet points.",
        history,
      }),
    });
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower === "/recap") {
    const knowledge = listKnowledge(input.db, { limit: 500 });
    await streamEphemeral({
      provider: input.provider,
      agentName: input.agentName,
      model: input.modelName,
      messages: buildRecapMessages({
        persona: input.activeProfilePersona,
        knowledge,
        mode: input.mode,
      }),
    });
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower.startsWith("/summarize")) {
    const url = normalized.slice("/summarize".length).trim();
    if (url.length === 0) {
      renderError("Usage: /summarize <url>");
      return true;
    }

    try {
      const content = await openPage(url);
      await streamEphemeral({
        provider: input.provider,
        agentName: input.agentName,
        model: input.modelName,
        messages: buildEphemeralMessages({
          persona: input.activeProfilePersona,
          mode: input.mode,
          userMessage: `Summarize this page concisely:\n\n${content}`,
        }),
      });
    } catch (error) {
      renderError(`Unable to summarize page: ${formatError(error)}`);
    }

    return true;
  }

  if (lower.startsWith("/save")) {
    const title = normalized.slice("/save".length).trim();
    if (!input.conversationId) {
      renderError("No active conversation to title.");
      return true;
    }
    if (title.length === 0) {
      renderError("Usage: /save <title>");
      return true;
    }

    updateConversationTitle(input.db, input.conversationId, title);
    renderSuccess(`✓ Saved title "${title}".`);
    input.lastUserPromptRef.value = null;
    return true;
  }

  if (lower.startsWith("/think")) {
    const question = normalized.slice("/think".length).trim();
    if (question.length === 0) {
      renderError("Usage: /think <question>");
      return true;
    }

    await streamEphemeral({
      provider: input.provider,
      agentName: input.agentName,
      model: input.modelName,
      messages: buildEphemeralMessages({
        persona: input.activeProfilePersona,
        mode: input.mode,
        userMessage: `Think through this step by step, show your reasoning:\n\n${question}`,
      }),
    });
    return true;
  }

  if (lower === "/status") {
    const info = [
      `mode=${input.mode}`,
      `provider=${input.providerName}`,
      `model=${input.modelName}`,
      `conversation=${input.conversationId ?? "none"}`,
    ].join(" · ");
    renderInfo(info);
    return true;
  }

  if (lower === "/retry") {
    const userPrompt = input.lastUserPromptRef.value;
    if (!userPrompt) {
      renderError("Nothing to retry yet.");
      return true;
    }

    const memoryAddition = buildMemoryAddition(input.db, userPrompt);
    const systemAddition = combineSystemAdditions([
      getModeSystemPrompt(input.mode),
      memoryAddition,
    ]);

    const retryResult = await streamReply(
      input.agent,
      userPrompt,
      input.conversationId,
      { model: input.modelName },
      input.agentName,
      systemAddition,
    );
    input.setConversationId(retryResult.conversationId);
    input.lastAssistantRef.value = retryResult.assistantText;
    saveEpisodeSummary(input.db, userPrompt, retryResult.assistantText);
    return true;
  }

  if (lower === "/copy") {
    if (!input.lastAssistantRef.value) {
      renderError("Nothing to copy yet.");
      return true;
    }

    const copied = copyToClipboard(input.lastAssistantRef.value);
    if (copied) {
      renderSuccess("✓ Copied last reply to clipboard.");
    } else {
      renderError("Clipboard tool not available.");
    }
    return true;
  }

  return false;
}

function buildMemoryAddition(db: HiveDatabase, userPrompt: string): string | undefined {
  const pinned = listPinnedKnowledge(db);
  const relevantEpisodes = findRelevantEpisodes(db, userPrompt, 3);

  const sections: string[] = [];

  if (pinned.length > 0) {
    sections.push(
      "Pinned knowledge:",
      ...pinned.map((item) => `- ${item.content}`),
    );
  }

  if (relevantEpisodes.length > 0) {
    sections.push(
      "Relevant memories:",
      ...relevantEpisodes.map((item) => `- ${item.episode.content}`),
    );
  }

  const combined = sections.join("\n");
  return combined.length > 0 ? combined : undefined;
}

function saveEpisodeSummary(db: HiveDatabase, userPrompt: string, assistantText: string): void {
  const summary = `User: ${userPrompt}\nHive: ${assistantText}`;
  const trimmed = summary.length > 2000 ? `${summary.slice(0, 2000)}…` : summary;
  insertEpisode(db, trimmed);
}

function copyToClipboard(text: string): boolean {
  const platform = process.platform;
  const buffer = Buffer.from(text, "utf8");

  if (platform === "darwin") {
    const result = spawnSync("pbcopy", [], { input: buffer });
    return result.status === 0;
  }

  const result = spawnSync("xclip", ["-selection", "clipboard"], { input: buffer });
  return result.status === 0;
}

let cachedLocalVersion: string | null = null;

async function checkForUpdates(): Promise<void> {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 3000),
    );

    const latest = (await Promise.race([
      fetch("https://registry.npmjs.org/@imisbahk/hive/latest").then((response) => response.json()),
      timeout,
    ])) as { version?: string } | undefined;

    if (!latest?.version || typeof latest.version !== "string") {
      return;
    }

    const localVersion = getLocalVersion();
    if (isVersionNewer(latest.version, localVersion)) {
      const amber = chalk.hex("#ffbf00");
      console.log(amber.dim(`✦ Update available v${localVersion} → npm update -g @imisbahk/hive`));
    }
  } catch {
    // Silently ignore update check failures.
  }
}

function getLocalVersion(): string {
  if (cachedLocalVersion) {
    return cachedLocalVersion;
  }

  try {
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version) {
      cachedLocalVersion = parsed.version;
      return cachedLocalVersion;
    }
  } catch {
    // ignore
  }

  cachedLocalVersion = "0.0.0";
  return cachedLocalVersion;
}

function isVersionNewer(remote: string, local: string): boolean {
  const toNumbers = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10));
  const r = toNumbers(remote);
  const l = toNumbers(local);
  const length = Math.max(r.length, l.length);

  for (let index = 0; index < length; index += 1) {
    const rv = r[index] ?? 0;
    const lv = l[index] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
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

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const answer = (await promptLine(question)).toLowerCase();
  return answer === "y" || answer === "yes";
}

async function streamEphemeral(input: {
  provider: Provider;
  agentName: string;
  model: string;
  messages: ProviderMessage[];
}): Promise<void> {
  process.stdout.write(getTheme().accent(`${input.agentName}${PROMPT_SYMBOL} `));
  let hadOutput = false;

  for await (const token of input.provider.streamChat({
    model: input.model ?? input.provider.defaultModel,
    messages: input.messages,
  })) {
    hadOutput = true;
    process.stdout.write(token);
  }

  if (!hadOutput) {
    process.stdout.write("(no response)");
  }

  process.stdout.write("\n");
  renderSeparator(EXCHANGE_SEPARATOR);
}

function buildEphemeralMessages(input: {
  persona: string;
  mode: ModeName;
  systemInstruction?: string;
  userMessage?: string;
  history?: MessageRecord[];
}): ProviderMessage[] {
  const messages: ProviderMessage[] = [
    { role: "system", content: RUNTIME_SYSTEM_GUARDRAILS },
    { role: "system", content: input.persona },
  ];

  const modePrompt = getModeSystemPrompt(input.mode);
  if (modePrompt) {
    messages.push({ role: "system", content: modePrompt });
  }

  if (input.systemInstruction) {
    messages.push({ role: "system", content: input.systemInstruction });
  }

  if (input.history) {
    messages.push(
      ...input.history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    );
  }

  if (input.userMessage) {
    messages.push({ role: "user", content: input.userMessage });
  }

  return messages;
}

function buildRecapMessages(input: {
  persona: string;
  knowledge: KnowledgeRecord[];
  mode: ModeName;
}): ProviderMessage[] {
  const knowledgeLines =
    input.knowledge.length > 0
      ? input.knowledge.map((row) => `- ${row.content}`).join("\n")
      : "No knowledge stored yet.";

  const userMessage = `Summarize everything you know about the user based on persona and knowledge facts below. Be concise.\n\nPersona:\n${input.persona}\n\nKnowledge facts:\n${knowledgeLines}`;

  return buildEphemeralMessages({
    persona: input.persona,
    mode: input.mode,
    userMessage,
  });
}

function formatConversationMarkdown(
  messages: MessageRecord[],
  conversationId: string,
): string {
  const lines = [`# Conversation ${conversationId}`, ""];

  for (const message of messages) {
    const speaker =
      message.role === "user"
        ? "User"
        : message.role === "assistant"
          ? "Hive"
          : "System";
    lines.push(`**${speaker}:**`, message.content, "");
  }

  return lines.join("\n");
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
