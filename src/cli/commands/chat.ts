import * as crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { Command } from "commander";
import type { Provider, ProviderMessage } from "../../providers/base.js";

import {
  RUNTIME_SYSTEM_GUARDRAILS,
  buildBrowserAugmentedPrompt,
  HiveAgent,
} from "../../agent/agent.js";
import { schedulePassiveMemory } from "../../agent/passive-memory.js";
import { initializeHiveCtxSession, type HiveCtxSession } from "../../agent/hive-ctx.js";
import { maybeAutoUpdatePromptsOnBoot } from "../../agent/prompt-auto-update.js";
import {
  closeHiveDatabase,
  getMetaValue,
  deleteKnowledge,
  findClosestKnowledge,
  type HiveDatabase,
  getPrimaryAgent,
  getHiveHomeDir,
  insertTask,
  listAutoKnowledge,
  insertKnowledge,
  listKnowledge,
  listTasks,
  clearCompletedTasks,
  setMetaValue,
  type KnowledgeRecord,
  type MessageRecord,
  listConversationMessages,
  listRecentConversations,
  openHiveDatabase,
  updateConversationTitle,
  clearEpisodes,
} from "../../storage/db.js";
import { createProvider, pingProvider } from "../../providers/index.js";
import { renderError, renderHiveHeader } from "../ui.js";
import {
  fetchLatestVersion,
  getLocalVersion,
  isMinorJump,
  isVersionNewer,
} from "../helpers/version.js";
import { formatRelativeTime, groupTasks } from "../helpers/tasks.js";
import { listPendingAuth } from "../../integrations/auth.js";
import {
  runConfigKeyCommandWithOptions,
  runConfigModelCommandWithOptions,
  runConfigProviderCommandWithOptions,
  runConfigShowCommandWithOptions,
  runConfigThemeCommandWithOptions,
} from "./config.js";
import { runStatusCommandWithOptions } from "./status.js";
import { TUI } from "../../ui/tui.js";
import {
  formatAgentLabel,
  formatAgentMessage,
  formatError as fmtError,
  formatInfo,
  formatSuccess,
  formatWarning,
} from "../../ui/renderer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type HiveShortcutResult = "not-handled" | "handled" | "config-updated";
type ModeName = "default" | "research" | "code" | "brainstorm" | "brief";

// ─── Constants ────────────────────────────────────────────────────────────────

const HIVE_SHORTCUT_PREFIX = "/hive";
const PREVIEW_AGENT_NAME = "jarvis";
const PREVIEW_PROVIDER = "google";
const PREVIEW_MODEL = "gemini-2.0-flash";
const MODE_PROMPTS: Record<ModeName, string | null> = {
  default: null,
  research:
    "Every answer must be grounded in current web evidence. Perform web search as needed and cite sources inline.",
  code: "Think and respond like a focused software engineer. Prioritize concise technical answers and code.",
  brainstorm:
    "Be creative and opinionated. Offer bold suggestions and push back on weak ideas when helpful.",
  brief: "Keep every response to a maximum of 3 sentences while preserving key details.",
};

const COMMAND_HELP_TEXT = [
  "Commands:",
  "  /help           show commands",
  "  /new            start a new conversation",
  "  /daemon         show daemon status",
  "  /integrations   show integrations status",
  "  /tasks          list background tasks",
  "  /task <desc>    queue a background task",
  "  /task clear     clear completed/failed tasks",
  "  /permissions    review pending auth",
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
  "  /clear           clear chat",
  "  /think <question>think step by step",
  "  /retry           resend last message",
  "  /copy            copy last reply",
  "  /terminal <cmd>  execute terminal command",
  "  /files <op>      filesystem operations (read/write/list/create/delete/move)",
  "  /hive memory list  show knowledge items",
  "  /hive memory auto  show auto-extracted facts",
  "  /hive memory clear clear episodic memory",
  "  /hive memory show  show current persona",
  "  /browse <url>   read a webpage",
  "  /search <query> search the web",
  "  /hive help      show Hive command shortcuts",
  "  /exit           quit",
].join("\n");

const HIVE_SHORTCUT_HELP_TEXT = [
  "Hive shortcuts:",
  "  /hive help         list shortcuts",
  "  /hive status       run hive status",
  "  /hive config show  run hive config show",
  "  /hive memory list  list knowledge",
  "  /hive memory auto  list auto facts",
  "  /hive memory clear clear episodes",
  "  /hive memory show  show persona",
].join("\n");

// ─── CLI registration ─────────────────────────────────────────────────────────

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

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runChatCommand(
  options: ChatCommandOptions,
  context: RunChatCommandContext = {},
): Promise<void> {
  const entrypoint = context.entrypoint ?? "chat-command";

  // One-shot message mode — keep legacy stdout path
  if (options.message && !options.preview) {
    await runOneShotMessage(options);
    return;
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

    if (entrypoint === "chat-command") {
      // legacy path still shows old header for `hive chat`
      renderHiveHeader("Chat");
    }

    notifyCompletedTasksSinceLastSession(db);
    setMetaValue(db, "last_session_at", new Date().toISOString());

    void maybeAutoUpdatePromptsOnBoot(db, (_message) => {
      // suppress — TUI not ready yet
    });

    let activeProfile = profile;
    const model = options.model ?? activeProfile.model;
    const ctxStoragePath = join(getHiveHomeDir(), "ctx");
    mkdirSync(ctxStoragePath, { recursive: true });
    let hiveCtx = await initializeHiveCtxSession({
      storagePath: ctxStoragePath,
      profile: activeProfile,
      model,
    });

    let provider = await createProvider(activeProfile.provider);
    let agent = new HiveAgent(db, provider, activeProfile);
    let agentName = resolveAgentName(activeProfile.agent_name);
    let currentMode: ModeName = "default";

    try {
      await pingProvider(provider, model);
    } catch {
      renderError("✗ Provider unreachable. Run `hive doctor` to diagnose.");
      return;
    }

    let conversationId = options.conversation;
    const runOptions: RunChatOptions = {
      model,
      title: options.title,
      temperature,
    };
    const lastUserPromptRef: { value: string | null } = { value: null };
    const lastAssistantRef: { value: string } = { value: "" };

    // ── Only check for updates in interactive mode ──
    void checkForUpdates();

    // ── Create the TUI ──────────────────────────────────────────────────────
    let exitRequested = false;

    const tui = new TUI({
      agentName,
      provider: activeProfile.provider,
      model,
      onExit: () => {
        exitRequested = true;
        tui.destroy();
        process.stdout.write("\n");
        process.stdin.pause();
        void attemptBrowserShutdown().finally(() => process.exit(0));
      },
      onInput: async (input: string) => {
        const normalizedPrompt = input.trim().toLowerCase();

        if (input === "/" || normalizedPrompt === "/help") {
          tui.appendMessage(formatInfo(COMMAND_HELP_TEXT));
          return;
        }

        if (normalizedPrompt === "/exit" || normalizedPrompt === "/quit") {
          exitRequested = true;
          tui.destroy();
          process.stdout.write("\n");
          process.stdin.pause();
          await attemptBrowserShutdown();
          process.exit(0);
        }

        if (normalizedPrompt === "/new") {
          conversationId = undefined;
          currentMode = "default";
          lastUserPromptRef.value = null;
          lastAssistantRef.value = "";
          tui.appendMessage(formatInfo("Started a new conversation context."));
          return;
        }

        // ── Slash command handling ──────────────────────────────────────────
        const handled = await handleChatSlashCommand({
          prompt: input,
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
          hiveCtx: hiveCtx.session,
          tui,
        });
        if (handled) return;

        // ── /hive shortcuts ─────────────────────────────────────────────────
        const shortcutResult = await handleHiveShortcut(input, {
          allowInteractiveConfig: true,
          db,
          tui,
        });
        if (shortcutResult === "handled") return;
        if (shortcutResult === "config-updated") {
          const latestProfile = getPrimaryAgent(db);
          if (!latestProfile) {
            tui.appendMessage(fmtError("Hive is not initialized. Run `hive init` first."));
            return;
          }

          activeProfile = latestProfile;
          const resolvedModel = options.model ?? activeProfile.model;
          hiveCtx = await initializeHiveCtxSession({
            storagePath: ctxStoragePath,
            profile: activeProfile,
            model: resolvedModel,
          });
          provider = await createProvider(activeProfile.provider);
          agent = new HiveAgent(db, provider, activeProfile);
          agentName = resolveAgentName(activeProfile.agent_name);
          if (!options.model) {
            runOptions.model = activeProfile.model;
          }

          try {
            await pingProvider(provider, runOptions.model ?? activeProfile.model);
          } catch {
            tui.appendMessage(fmtError("✗ Provider unreachable. Run `hive doctor` to diagnose."));
            return;
          }

          conversationId = undefined;
          tui.updateStatus({
            agentName,
            provider: activeProfile.provider,
            model: runOptions.model ?? activeProfile.model,
          });
          tui.appendMessage(
            formatInfo(`Switched to ${activeProfile.provider} · ${runOptions.model ?? activeProfile.model}.`),
          );
          tui.appendMessage(formatInfo("Started a new conversation context."));
          return;
        }

        if (isUnknownSlashCommand(input)) {
          tui.appendMessage(fmtError("✗ Unknown command. Type /help for available commands."));
          return;
        }

        // ── Normal message → agent ──────────────────────────────────────────
        const augmentedPrompt = await buildBrowserAugmentedPrompt(input, {
          locationHint: activeProfile.location ?? undefined,
        });
        lastUserPromptRef.value = input;
        const systemAddition = getModeSystemPrompt(currentMode);

        try {
          const streamResult = await streamReply({
            agent,
            provider,
            db,
            prompt: augmentedPrompt,
            rawPrompt: input,
            conversationId,
            options: runOptions,
            agentName,
            systemAddition,
            hiveCtx: hiveCtx.session,
            tui,
          });
          conversationId = streamResult.conversationId;
          lastAssistantRef.value = streamResult.assistantText;
          // Update ctx token count in status bar
          if (streamResult.ctxTokenCount !== undefined) {
            tui.updateStatus({ ctxTokens: streamResult.ctxTokenCount });
          }
        } catch (error) {
          tui.appendMessage(fmtError(`✗ ${formatError(error)}`));
        }
      },
    });

    // Show agent name once at startup
    tui.appendMessage(formatAgentLabel(agentName));
    tui.appendMessage(formatInfo("? for help · /exit to quit"));
    tui.appendMessage("");

    const pending = listPendingAuth();
    if (pending.length > 0) {
      tui.appendMessage(
        formatInfo(
          `✦ ${pending.length} authorization request${pending.length > 1 ? "s" : ""} pending — run /permissions to allow or block`,
        ),
      );
    }

    // Keep process alive; TUI event loop takes over.
    await new Promise<void>((resolve) => {
      // Resolve when exit is triggered from within onExit/onInput.
      // In practice, process.exit() is called in onExit, so this is a safety net.
      if (exitRequested) resolve();
    });
  } finally {
    closeHiveDatabase(db);
  }
}

// ─── One-shot (non-interactive) message ───────────────────────────────────────

async function runOneShotMessage(options: ChatCommandOptions): Promise<void> {
  const db = openHiveDatabase();
  try {
    const profile = getPrimaryAgent(db);
    if (!profile) {
      renderError("Hive is not initialized. Run `hive init` first.");
      return;
    }

    const model = options.model ?? profile.model;
    const ctxStoragePath = join(getHiveHomeDir(), "ctx");
    mkdirSync(ctxStoragePath, { recursive: true });
    const hiveCtx = await initializeHiveCtxSession({
      storagePath: ctxStoragePath,
      profile,
      model,
    });

    const provider = await createProvider(profile.provider);
    const agent = new HiveAgent(db, provider, profile);
    const agentName = resolveAgentName(profile.agent_name);

    const message = options.message!;
    const augmentedMessage = await buildBrowserAugmentedPrompt(message, {
      locationHint: profile.location ?? undefined,
    });

    let assistantText = "";
    let ctxSystemPrompt: string | undefined;
    let conversationId = options.conversation;

    if (hiveCtx.session) {
      const context = await hiveCtx.session.build(message);
      ctxSystemPrompt = context.system;
    }

    process.stdout.write(`${agentName}: `);
    for await (const event of agent.chat(augmentedMessage, {
      conversationId,
      model,
      title: options.title,
      contextSystemPrompt: ctxSystemPrompt,
      disableLegacyEpisodeStore: Boolean(hiveCtx.session),
    })) {
      if (event.type === "token") {
        process.stdout.write(event.token);
        assistantText += event.token;
        conversationId = event.conversationId;
      } else {
        conversationId = event.conversationId;
      }
    }
    process.stdout.write("\n");

    if (hiveCtx.session) {
      await Promise.resolve(hiveCtx.session.episode(message, assistantText)).catch(() => { });
    }

    schedulePassiveMemory({
      db,
      provider,
      model,
      userMessage: message,
      assistantMessage: assistantText,
      hiveCtx: hiveCtx.session,
    });

    if (conversationId) {
      process.stderr.write(`conversation: ${conversationId}\n`);
    }
  } finally {
    closeHiveDatabase(db);
  }
}

// ─── Preview session ──────────────────────────────────────────────────────────

async function runPreviewSession(options: ChatCommandOptions): Promise<void> {
  const model = options.model ?? PREVIEW_MODEL;
  const agentName = PREVIEW_AGENT_NAME;

  if (options.message) {
    process.stdout.write(`${agentName}: preview mode: received "${options.message}"\n`);
    return;
  }

  const tui = new TUI({
    agentName,
    provider: PREVIEW_PROVIDER,
    model,
    onExit: () => {
      tui.destroy();
      process.exit(0);
    },
    onInput: async (input: string) => {
      const lower = input.trim().toLowerCase();
      if (lower === "/help" || input === "/") {
        tui.appendMessage(formatInfo(COMMAND_HELP_TEXT));
        return;
      }
      if (lower === "/exit" || lower === "/quit") {
        tui.destroy();
        process.exit(0);
      }
      if (lower === "/new") {
        tui.appendMessage(formatInfo("Started a new preview conversation context."));
        return;
      }
      if (isHiveShortcut(input)) {
        tui.appendMessage(formatInfo("Hive shortcuts are unavailable in preview mode."));
        return;
      }
      if (isUnknownSlashCommand(input)) {
        tui.appendMessage(fmtError(`Unknown command: ${input}`));
        return;
      }
      tui.appendMessage(formatInfo(`preview mode: received "${input}"`));
    },
  });

  tui.appendMessage(formatAgentLabel(agentName));
  tui.appendMessage(formatInfo("Preview mode — no agent connected"));

  await new Promise<void>(() => {
    // Keep alive; process.exit() called from onExit.
  });
}

// ─── Stream reply ─────────────────────────────────────────────────────────────

interface StreamResult {
  conversationId: string;
  assistantText: string;
  ctxTokenCount?: number;
}

async function streamReply(input: {
  agent: HiveAgent;
  provider: Provider;
  db: HiveDatabase;
  prompt: string;
  rawPrompt: string;
  conversationId: string | undefined;
  options: RunChatOptions;
  agentName: string;
  systemAddition?: string;
  hiveCtx: HiveCtxSession | null;
  tui: TUI;
}): Promise<StreamResult> {
  const { tui } = input;

  tui.showSpinner();

  let activeConversationId = input.conversationId;
  let assistantText = "";
  let ctxSystemPrompt: string | undefined;
  let ctxTokenCount: number | undefined;
  let firstToken = false;

  try {
    if (input.hiveCtx) {
      const context = await input.hiveCtx.build(input.rawPrompt);
      ctxSystemPrompt = context.system;
      ctxTokenCount = context.tokens;
    }

    for await (const event of input.agent.chat(input.prompt, {
      conversationId: activeConversationId,
      model: input.options.model,
      temperature: input.options.temperature,
      title: input.options.title,
      systemAddition: input.systemAddition,
      contextSystemPrompt: ctxSystemPrompt,
      disableLegacyEpisodeStore: Boolean(input.hiveCtx),
    })) {
      if (event.type === "token") {
        if (!firstToken) {
          firstToken = true;
          tui.hideSpinner();
        }
        tui.appendToken(event.token);
        activeConversationId = event.conversationId;
        assistantText += event.token;
        continue;
      }
      activeConversationId = event.conversationId;
    }
  } finally {
    tui.hideSpinner();
  }

  tui.flushStream();

  if (!firstToken) {
    tui.appendMessage(fmtError("✗ No response received."));
  }

  if (!activeConversationId) {
    throw new Error("Conversation state was not returned by the agent.");
  }

  if (input.hiveCtx) {
    await Promise.resolve(input.hiveCtx.episode(input.rawPrompt, assistantText)).catch(() => { });
  }

  if (ctxTokenCount !== undefined) {
    tui.appendMessage(formatInfo(`· ~${ctxTokenCount} ctx tokens`));
  }

  schedulePassiveMemory({
    db: input.db,
    provider: input.provider,
    model: input.options.model ?? input.agent.getProfile().model,
    userMessage: input.rawPrompt,
    assistantMessage: assistantText,
    hiveCtx: input.hiveCtx,
  });

  return { conversationId: activeConversationId, assistantText, ctxTokenCount };
}

// ─── Slash command handler ────────────────────────────────────────────────────

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
  hiveCtx: HiveCtxSession | null;
  tui: TUI;
}): Promise<boolean> {
  const normalized = input.prompt.trim();
  const lower = normalized.toLowerCase();
  const { tui } = input;

  if (!lower.startsWith("/")) return false;

  if (lower === "/clear") {
    tui.clearChat();
    return true;
  }

  if (lower === "/daemon") {
    const statusLine = await getDaemonStatusLineInline();
    tui.appendMessage(formatInfo(statusLine));
    return true;
  }

  if (lower === "/integrations") {
    const home = getHiveHomeDir();
    const portFile = join(home, "daemon.port");
    const port = readNumberFromFile(portFile) ?? 2718;
    const live = await getDaemonStatusViaTcp(port);
    const integrations = (live?.integrations ?? null) as Record<string, string> | null;
    if (!integrations) {
      tui.appendMessage(formatInfo("Integrations: n/a (daemon not reachable)"));
      return true;
    }
    const platforms = ["telegram", "whatsapp", "discord", "slack"];
    const line = platforms
      .map((p) => {
        const v = integrations[p];
        if (v === "running") return `${p} ✓`;
        if (v === "disabled") return `${p} —`;
        return `${p} ✗`;
      })
      .join("  ");
    tui.appendMessage(formatInfo(`Integrations: ${line}`));
    return true;
  }

  if (lower === "/integrations auth" || lower === "/permissions") {
    const pending = listPendingAuth();
    if (pending.length === 0) {
      tui.appendMessage(formatInfo("No pending authorization requests."));
      return true;
    }
    tui.appendMessage(formatInfo(`✦ ${pending.length} authorization request(s) pending`));
    pending.forEach((req) => {
      tui.appendMessage(formatInfo(`· ${req.from} on ${capitalizePlatform(req.platform)}`));
    });
    tui.appendMessage(formatInfo("Run: hive integrations auth add <platform> <id>"));
    return true;
  }

  if (lower === "/tasks") {
    const tasks = listTasks(input.db);
    if (tasks.length === 0) {
      tui.appendMessage(formatInfo("No tasks yet."));
      return true;
    }
    const grouped = groupTasks(tasks);
    tui.appendMessage(formatInfo("◆ Tasks"));
    tui.appendMessage(formatInfo(`Running (${grouped.running.length})`));
    grouped.running.forEach((task) => {
      tui.appendMessage(formatInfo(`· ${task.id}  ${task.title}  started ${formatRelativeTime(task.started_at)}`));
    });
    tui.appendMessage(formatInfo(`Queued (${grouped.queued.length})`));
    grouped.queued.forEach((task) => {
      tui.appendMessage(formatInfo(`· ${task.id}  ${task.title}`));
    });
    tui.appendMessage(formatInfo(`Done (${grouped.done.length})`));
    grouped.done.forEach((task) => {
      tui.appendMessage(formatInfo(`· ${task.id}  ✓ ${task.title}  ${formatRelativeTime(task.completed_at)}`));
    });
    tui.appendMessage(formatInfo(`Failed (${grouped.failed.length})`));
    grouped.failed.forEach((task) => {
      const tail = task.error ? ` · ${task.error}` : "";
      tui.appendMessage(formatInfo(`· ${task.id}  ✗ ${task.title}  ${formatRelativeTime(task.completed_at)}${tail}`));
    });
    return true;
  }

  if (lower.startsWith("/task ")) {
    const title = normalized.slice("/task".length).trim();
    if (!title) {
      tui.appendMessage(fmtError("Usage: /task <description>"));
      return true;
    }
    const agentId = getPrimaryAgent(input.db)?.id ?? null;
    const id = createTaskId();
    insertTask(input.db, { id, title, agentId });
    void sendDaemonCommandInline({ type: "task", payload: { id, title, agent_id: agentId } });
    tui.appendMessage(formatSuccess(`Task queued · ${id}`));
    return true;
  }

  if (lower === "/task clear") {
    const deleted = clearCompletedTasks(input.db);
    tui.appendMessage(formatSuccess(`Cleared ${deleted} tasks.`));
    return true;
  }

  if (lower.startsWith("/remember")) {
    const fact = normalized.slice("/remember".length).trim();
    if (fact.length === 0) {
      tui.appendMessage(fmtError("Usage: /remember <fact>"));
      return true;
    }
    if (input.hiveCtx) {
      await input.hiveCtx.remember(fact);
    } else {
      insertKnowledge(input.db, { content: fact });
    }
    tui.appendMessage(formatSuccess("Remembered."));
    return true;
  }

  if (lower.startsWith("/forget")) {
    const query = normalized.slice("/forget".length).trim();
    if (query.length === 0) {
      tui.appendMessage(fmtError("Usage: /forget <thing>"));
      return true;
    }
    const match = findClosestKnowledge(input.db, query);
    if (!match) {
      tui.appendMessage(fmtError("No similar knowledge found."));
      return true;
    }
    deleteKnowledge(input.db, match.id);
    tui.appendMessage(formatSuccess(`Forgotten: "${match.content}"`));
    return true;
  }

  if (lower.startsWith("/mode")) {
    const modeName = normalized.slice("/mode".length).trim().toLowerCase();
    if (!modeName || !Object.hasOwn(MODE_PROMPTS, modeName)) {
      tui.appendMessage(fmtError("Usage: /mode <default|research|code|brainstorm|brief>"));
      return true;
    }
    input.setMode(modeName as ModeName);
    tui.appendMessage(formatSuccess(`Mode set to ${modeName}.`));
    return true;
  }

  if (lower.startsWith("/pin")) {
    const fact = normalized.slice("/pin".length).trim();
    if (fact.length === 0) {
      tui.appendMessage(fmtError("Usage: /pin <fact>"));
      return true;
    }
    if (input.hiveCtx) {
      await input.hiveCtx.remember(fact, { pinned: true });
    } else {
      insertKnowledge(input.db, { content: fact, pinned: true });
    }
    tui.appendMessage(formatSuccess("Pinned."));
    return true;
  }

  if (lower === "/export") {
    if (!input.conversationId) {
      tui.appendMessage(fmtError("No conversation to export. Start chatting first."));
      return true;
    }
    const messages = listConversationMessages(input.db, input.conversationId);
    const exportDir = join(getHiveHomeDir(), "exports");
    mkdirSync(exportDir, { recursive: true });
    const exportPath = join(exportDir, `${input.conversationId}.md`);
    writeFileSync(exportPath, formatConversationMarkdown(messages, input.conversationId));
    tui.appendMessage(formatSuccess(`Exported to ${exportPath}`));
    return true;
  }

  if (lower === "/history") {
    const rows = listRecentConversations(input.db, 10);
    if (rows.length === 0) {
      tui.appendMessage(formatInfo("No past conversations found."));
      return true;
    }
    rows.forEach((row, i) => {
      const title = row.title?.trim().length ? row.title : "(untitled)";
      tui.appendMessage(formatInfo(`${i + 1}. ${title} · ${row.updated_at} · ${row.message_count} messages`));
    });
    return true;
  }

  if (lower === "/tldr") {
    if (!input.conversationId) {
      tui.appendMessage(fmtError("No conversation yet. Say something first."));
      return true;
    }
    const history = listConversationMessages(input.db, input.conversationId);
    if (history.length === 0) {
      tui.appendMessage(fmtError("Nothing to summarize yet."));
      return true;
    }
    await streamEphemeral({
      provider: input.provider,
      model: input.modelName,
      messages: buildEphemeralMessages({
        persona: input.activeProfilePersona,
        mode: input.mode,
        systemInstruction: "Summarize this conversation in 3-5 bullet points.",
        history,
      }),
      tui,
    });
    return true;
  }

  if (lower === "/recap") {
    const knowledge = listKnowledge(input.db, { limit: 500 });
    await streamEphemeral({
      provider: input.provider,
      model: input.modelName,
      messages: buildRecapMessages({ persona: input.activeProfilePersona, knowledge, mode: input.mode }),
      tui,
    });
    return true;
  }

  if (lower.startsWith("/summarize")) {
    const url = normalized.slice("/summarize".length).trim();
    if (url.length === 0) {
      tui.appendMessage(fmtError("Usage: /summarize <url>"));
      return true;
    }
    try {
      const { openPage } = await import("../../browser/browser.js");
      const content = await openPage(url);
      await streamEphemeral({
        provider: input.provider,
        model: input.modelName,
        messages: buildEphemeralMessages({
          persona: input.activeProfilePersona,
          mode: input.mode,
          userMessage: `Summarize this page concisely:\n\n${content}`,
        }),
        tui,
      });
    } catch (error) {
      tui.appendMessage(fmtError(`Unable to summarize page: ${formatError(error)}`));
    }
    return true;
  }

  if (lower.startsWith("/save")) {
    const title = normalized.slice("/save".length).trim();
    if (!input.conversationId) {
      tui.appendMessage(fmtError("No active conversation to title."));
      return true;
    }
    if (title.length === 0) {
      tui.appendMessage(fmtError("Usage: /save <title>"));
      return true;
    }
    updateConversationTitle(input.db, input.conversationId, title);
    tui.appendMessage(formatSuccess(`Saved title "${title}".`));
    return true;
  }

  if (lower.startsWith("/think")) {
    const question = normalized.slice("/think".length).trim();
    if (question.length === 0) {
      tui.appendMessage(fmtError("Usage: /think <question>"));
      return true;
    }
    await streamEphemeral({
      provider: input.provider,
      model: input.modelName,
      messages: buildEphemeralMessages({
        persona: input.activeProfilePersona,
        mode: input.mode,
        userMessage: `Think through this step by step, show your reasoning:\n\n${question}`,
      }),
      tui,
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
    tui.appendMessage(formatInfo(info));
    return true;
  }

  if (lower === "/retry") {
    const userPrompt = input.lastUserPromptRef.value;
    if (!userPrompt) {
      tui.appendMessage(fmtError("Nothing to retry yet."));
      return true;
    }
    const systemAddition = getModeSystemPrompt(input.mode);
    const retryResult = await streamReply({
      agent: input.agent,
      provider: input.provider,
      db: input.db,
      prompt: userPrompt,
      rawPrompt: userPrompt,
      conversationId: input.conversationId,
      options: { model: input.modelName },
      agentName: input.agentName,
      systemAddition,
      hiveCtx: input.hiveCtx,
      tui,
    });
    input.setConversationId(retryResult.conversationId);
    input.lastAssistantRef.value = retryResult.assistantText;
    return true;
  }

  if (lower === "/copy") {
    if (!input.lastAssistantRef.value) {
      tui.appendMessage(fmtError("Nothing to copy yet."));
      return true;
    }
    const copied = copyToClipboard(input.lastAssistantRef.value);
    if (copied) {
      tui.appendMessage(formatSuccess("Copied last reply to clipboard."));
    } else {
      tui.appendMessage(fmtError("Clipboard tool not available."));
    }
    return true;
  }

  if (lower.startsWith("/terminal ")) {
    const command = normalized.slice("/terminal".length).trim();
    if (!command) {
      tui.appendMessage(fmtError("Usage: /terminal <command>"));
      return true;
    }
    try {
      const { terminalTool } = await import("../../tools/terminal.js");
      const result = await terminalTool.runCommand(command);
      tui.appendMessage(formatInfo(`Command: ${command}`));
      if (result.stdout) tui.appendMessage(result.stdout);
      if (result.stderr) tui.appendMessage(fmtError(result.stderr));
      tui.appendMessage(formatInfo(`Exit code: ${result.exitCode}`));
    } catch (error) {
      tui.appendMessage(fmtError(`Terminal error: ${formatError(error)}`));
    }
    return true;
  }

  if (lower.startsWith("/files ")) {
    const args = normalized.slice("/files".length).trim();
    if (!args) {
      tui.appendMessage(fmtError("Usage: /files <operation> [args]"));
      tui.appendMessage(formatInfo("Operations: read <path>, write <path> <content>, list <path>, create <path>, delete <path>, move <src> <dest>"));
      return true;
    }
    try {
      const { filesystemTool } = await import("../../tools/filesystem.js");
      const parts = args.split(" ");
      const operation = parts[0];
      switch (operation) {
        case "read": {
          if (parts.length < 2) { tui.appendMessage(fmtError("Usage: /files read <path>")); return true; }
          const content = await filesystemTool.readFile(parts[1]!);
          tui.appendMessage(content);
          break;
        }
        case "write": {
          if (parts.length < 3) { tui.appendMessage(fmtError("Usage: /files write <path> <content>")); return true; }
          await filesystemTool.writeFile(parts[1]!, parts.slice(2).join(" "));
          tui.appendMessage(formatSuccess(`Wrote to ${parts[1]}`));
          break;
        }
        case "list": {
          if (parts.length < 2) { tui.appendMessage(fmtError("Usage: /files list <path>")); return true; }
          const entries = await filesystemTool.listDir(parts[1]!);
          entries.forEach((e: string) => tui.appendMessage(e));
          break;
        }
        case "create": {
          if (parts.length < 2) { tui.appendMessage(fmtError("Usage: /files create <path>")); return true; }
          await filesystemTool.createDir(parts[1]!);
          tui.appendMessage(formatSuccess(`Created directory ${parts[1]}`));
          break;
        }
        case "delete": {
          if (parts.length < 2) { tui.appendMessage(fmtError("Usage: /files delete <path>")); return true; }
          await filesystemTool.deleteFile(parts[1]!, true);
          tui.appendMessage(formatSuccess(`Deleted ${parts[1]}`));
          break;
        }
        case "move": {
          if (parts.length < 3) { tui.appendMessage(fmtError("Usage: /files move <src> <dest>")); return true; }
          await filesystemTool.moveFile(parts[1]!, parts[2]!);
          tui.appendMessage(formatSuccess(`Moved ${parts[1]} to ${parts[2]}`));
          break;
        }
        default:
          tui.appendMessage(fmtError(`Unknown operation: ${operation}`));
          tui.appendMessage(formatInfo("Operations: read, write, list, create, delete, move"));
      }
    } catch (error) {
      tui.appendMessage(fmtError(`Filesystem error: ${formatError(error)}`));
    }
    return true;
  }

  // /browse and /search — treated as regular messages (agent handles them via
  // buildBrowserAugmentedPrompt), so we return false to fall through.
  if (lower.startsWith("/browse ") || lower.startsWith("/search ")) {
    return false;
  }

  return false;
}

// ─── /hive shortcuts ──────────────────────────────────────────────────────────

async function handleHiveShortcut(
  prompt: string,
  options: {
    allowInteractiveConfig?: boolean;
    db?: HiveDatabase;
    tui: TUI;
  },
): Promise<HiveShortcutResult> {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  const { tui } = options;

  if (lower === HIVE_SHORTCUT_PREFIX) {
    tui.appendMessage(formatInfo(HIVE_SHORTCUT_HELP_TEXT));
    return "handled";
  }

  if (!lower.startsWith(`${HIVE_SHORTCUT_PREFIX} `)) {
    return "not-handled";
  }

  const rawSubcommand = normalized.slice(HIVE_SHORTCUT_PREFIX.length).trim();
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand.length === 0 || subcommand === "help") {
    tui.appendMessage(formatInfo(HIVE_SHORTCUT_HELP_TEXT));
    return "handled";
  }

  if (subcommand === "status") {
    // Capture output by temporarily hooking console.log
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    await runStatusCommandWithOptions({ showHeader: false });
    console.log = orig;
    lines.forEach((l) => tui.appendMessage(formatInfo(l)));
    return "handled";
  }

  if (subcommand === "config show") {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    await runConfigShowCommandWithOptions({ showHeader: false });
    console.log = orig;
    lines.forEach((l) => tui.appendMessage(formatInfo(l)));
    return "handled";
  }

  if (subcommand === "memory list") {
    const db = options.db;
    if (!db) { tui.appendMessage(fmtError("Memory commands unavailable: database not open.")); return "handled"; }
    const rows = listKnowledge(db, { limit: 1000 });
    if (rows.length === 0) { tui.appendMessage(formatInfo("No knowledge stored.")); return "handled"; }
    rows.forEach((row, i) => {
      const pinnedLabel = row.pinned ? " (pinned)" : "";
      tui.appendMessage(formatInfo(`${i + 1}. ${row.content}${pinnedLabel}`));
    });
    return "handled";
  }

  if (subcommand === "memory auto") {
    const db = options.db;
    if (!db) { tui.appendMessage(fmtError("Memory commands unavailable: database not open.")); return "handled"; }
    const autos = listAutoKnowledge(db, 1000);
    if (autos.length === 0) { tui.appendMessage(formatInfo("No auto-extracted facts yet.")); return "handled"; }
    autos.forEach((row, i) => {
      tui.appendMessage(formatInfo(`${i + 1}. [auto] ${row.content} · ${row.created_at}`));
    });
    return "handled";
  }

  if (subcommand === "memory clear") {
    const db = options.db;
    if (!db) { tui.appendMessage(fmtError("Memory commands unavailable: database not open.")); return "handled"; }
    clearEpisodes(db);
    tui.appendMessage(formatSuccess("Episodes cleared."));
    return "handled";
  }

  if (subcommand === "memory show") {
    const db = options.db;
    if (!db) { tui.appendMessage(fmtError("Memory commands unavailable: database not open.")); return "handled"; }
    const agent = getPrimaryAgent(db);
    if (!agent) { tui.appendMessage(fmtError("Hive is not initialized. Run `hive init` first.")); return "handled"; }
    tui.appendMessage(formatInfo(agent.persona));
    return "handled";
  }

  if (subcommand === "config provider") {
    if (!options.allowInteractiveConfig) { tui.appendMessage(formatInfo("Interactive config commands are unavailable here.")); return "handled"; }
    await runConfigProviderCommandWithOptions({ showHeader: false });
    return "config-updated";
  }

  if (subcommand === "config model") {
    if (!options.allowInteractiveConfig) { tui.appendMessage(formatInfo("Interactive config commands are unavailable here.")); return "handled"; }
    await runConfigModelCommandWithOptions({ showHeader: false });
    return "config-updated";
  }

  if (subcommand === "config key") {
    if (!options.allowInteractiveConfig) { tui.appendMessage(formatInfo("Interactive config commands are unavailable here.")); return "handled"; }
    await runConfigKeyCommandWithOptions({ showHeader: false });
    return "handled";
  }

  if (subcommand === "config theme") {
    if (!options.allowInteractiveConfig) { tui.appendMessage(formatInfo("Interactive config commands are unavailable here.")); return "handled"; }
    await runConfigThemeCommandWithOptions({ showHeader: false });
    return "handled";
  }

  if (subcommand === "init" || subcommand === "nuke") {
    tui.appendMessage(formatInfo(`Run \`hive ${rawSubcommand}\` from your shell. This command is interactive.`));
    return "handled";
  }

  tui.appendMessage(fmtError(`Unknown Hive shortcut: /hive ${rawSubcommand}`));
  tui.appendMessage(formatInfo("Use `/hive help` to list available shortcuts."));
  return "handled";
}

// ─── Ephemeral stream (tldr, recap, think, summarize) ─────────────────────────

async function streamEphemeral(input: {
  provider: Provider;
  model: string;
  messages: ProviderMessage[];
  tui: TUI;
}): Promise<void> {
  const { tui } = input;
  tui.showSpinner();
  let hadOutput = false;
  let firstToken = false;

  try {
    for await (const token of input.provider.streamChat({
      model: input.model ?? input.provider.defaultModel,
      messages: input.messages,
    })) {
      hadOutput = true;
      if (!firstToken) {
        firstToken = true;
        tui.hideSpinner();
      }
      tui.appendToken(token);
    }
  } finally {
    tui.hideSpinner();
  }

  tui.flushStream();

  if (!hadOutput) {
    tui.appendMessage(formatInfo("(no response)"));
  }
}

// ─── Ephemeral message builders ───────────────────────────────────────────────

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
  if (modePrompt) messages.push({ role: "system", content: modePrompt });
  if (input.systemInstruction) messages.push({ role: "system", content: input.systemInstruction });
  if (input.history) {
    messages.push(...input.history.map((m) => ({ role: m.role, content: m.content })));
  }
  if (input.userMessage) messages.push({ role: "user", content: input.userMessage });
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
  return buildEphemeralMessages({ persona: input.persona, mode: input.mode, userMessage });
}

function formatConversationMarkdown(messages: MessageRecord[], conversationId: string): string {
  const lines = [`# Conversation ${conversationId}`, ""];
  for (const message of messages) {
    const speaker = message.role === "user" ? "User" : message.role === "assistant" ? "Hive" : "System";
    lines.push(`**${speaker}:**`, message.content, "");
  }
  return lines.join("\n");
}

// ─── Daemon helpers ───────────────────────────────────────────────────────────

async function getDaemonStatusLineInline(): Promise<string> {
  const home = getHiveHomeDir();
  const portFile = join(home, "daemon.port");
  const pidFile = join(home, "daemon.pid");
  const watcherPidFile = join(home, "daemon.watcher.pid");
  const lockFile = join(home, "daemon.lock");

  const port = readNumberFromFile(portFile) ?? 2718;
  const pid = readNumberFromFile(pidFile);
  const watcherPid = readNumberFromFile(watcherPidFile);

  const watcherRunning =
    watcherPid !== null && isProcessRunning(watcherPid)
      ? `watcher PID ${watcherPid}`
      : "watcher stopped";

  const live = await getDaemonStatusViaTcp(port);
  if (live) {
    const livePid = typeof live.pid === "number" ? live.pid : pid;
    const uptime = typeof live.uptime === "string" ? live.uptime : "n/a";
    return `daemon running${livePid ? ` (PID ${livePid}, ${uptime})` : ""} · ${watcherRunning}`;
  }

  const heartbeat = getHeartbeatAge(lockFile);
  if (pid !== null && isProcessRunning(pid)) {
    return `daemon running (PID ${pid}) · ${watcherRunning} · heartbeat: ${heartbeat}`;
  }

  return `daemon stopped · ${watcherRunning}`;
}

function readNumberFromFile(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getHeartbeatAge(lockFile: string): string {
  const lockTime = readNumberFromFile(lockFile);
  if (lockTime === null) return "unknown";
  const ageMs = Date.now() - lockTime;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  return `${Math.floor(ageMs / 60_000)}m ago`;
}

function getDaemonStatusViaTcp(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "status" }) + "\n");
    });
    let buffer = "";
    let responded = false;
    socket.on("data", (data: Buffer) => {
      if (responded) return;
      buffer += data.toString();
      try {
        const response = JSON.parse(buffer) as Record<string, unknown>;
        responded = true;
        socket.end();
        resolve(response);
      } catch {
        // wait for more data
      }
    });
    socket.on("error", () => { if (!responded) { socket.destroy(); resolve(null); } });
    socket.setTimeout(500, () => { if (!responded) { socket.destroy(); resolve(null); } });
  });
}

async function sendDaemonCommandInline(payload: Record<string, unknown>): Promise<void> {
  const home = getHiveHomeDir();
  const portFile = join(home, "daemon.port");
  const port = readNumberFromFile(portFile) ?? 2718;
  await new Promise<void>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify(payload) + "\n");
    });
    socket.on("error", () => resolve());
    socket.setTimeout(500, () => { socket.destroy(); resolve(); });
    socket.on("close", () => resolve());
  });
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

async function attemptBrowserShutdown(): Promise<void> {
  try {
    const browser = (await import("../../browser/browser.js")) as Partial<{
      closeBrowser: () => Promise<void>;
    }>;
    if (typeof browser.closeBrowser === "function") {
      await Promise.race([
        browser.closeBrowser(),
        new Promise<void>((resolve) => setTimeout(resolve, 200)),
      ]);
    }
  } catch {
    // ignore
  }
}

function parseTemperature(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
    throw new Error("Temperature must be a number between 0 and 2.");
  }
  return parsed;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveAgentName(agentName: string | null | undefined): string {
  const normalized = agentName?.trim();
  if (normalized && normalized.length > 0) return normalized;
  return "hive";
}

function getModeSystemPrompt(mode: ModeName): string | undefined {
  return MODE_PROMPTS[mode] ?? undefined;
}

function isHiveShortcut(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return normalized === HIVE_SHORTCUT_PREFIX || normalized.startsWith(`${HIVE_SHORTCUT_PREFIX} `);
}

function isUnknownSlashCommand(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized.startsWith("/")) return false;
  const known = [
    "/help", "/new", "/daemon", "/integrations", "/integrations auth", "/permissions",
    "/tasks", "/task", "/exit", "/quit", "/remember", "/forget", "/summarize", "/tldr",
    "/recap", "/mode", "/export", "/history", "/clear", "/think", "/save", "/pin",
    "/status", "/retry", "/copy", "/browse", "/search", "/terminal", "/files",
    HIVE_SHORTCUT_PREFIX,
  ];
  for (const k of known) {
    if (normalized === k || normalized.startsWith(`${k} `)) return false;
  }
  return true;
}

function capitalizePlatform(platform: string): string {
  if (!platform) return platform;
  return platform.slice(0, 1).toUpperCase() + platform.slice(1).toLowerCase();
}

function createTaskId(): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `t-${hex}`;
}

function copyToClipboard(text: string): boolean {
  const buffer = Buffer.from(text, "utf8");
  if (process.platform === "darwin") {
    return spawnSync("pbcopy", [], { input: buffer }).status === 0;
  }
  return spawnSync("xclip", ["-selection", "clipboard"], { input: buffer }).status === 0;
}

async function checkForUpdates(): Promise<void> {
  try {
    const latest = await fetchLatestVersion();
    if (!latest) return;
    const localVersion = getLocalVersion();
    if (isVersionNewer(latest, localVersion) && isMinorJump(latest, localVersion)) {
      // Will be shown in chatBox by the TUI session post-init
      process.stderr.write(`✦ Update available v${latest} → run hive update\n`);
    }
  } catch {
    // ignore
  }
}

function notifyCompletedTasksSinceLastSession(db: HiveDatabase): void {
  const last = getMetaValue(db, "last_session_at");
  if (!last) return;
  const lastTs = Date.parse(last);
  if (!Number.isFinite(lastTs)) return;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(1) AS count FROM tasks
         WHERE status IN ('done','failed')
           AND completed_at IS NOT NULL
           AND datetime(completed_at) > datetime(?)`,
      )
      .get(last) as { count: number } | undefined;
    const count = row?.count ?? 0;
    if (count <= 0) return;
    process.stderr.write(`✦ ${count} task${count > 1 ? "s" : ""} completed since your last session\n`);
  } catch {
    // ignore
  }
}
