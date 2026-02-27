import type { IncomingMessage } from "./handler.js";
import type { IntegrationPlatform } from "./auth.js";
import TelegramBot from "node-telegram-bot-api";

export interface TelegramIntegrationDeps {
  token: string;
  handleMessage: (msg: IncomingMessage) => Promise<{ text: string; replyTo?: string; to: string }>;
  log: (line: string) => void;
  getTasksText: () => Promise<string>;
  getStatusText: () => Promise<string>;
}

export interface RunningIntegration {
  platform: IntegrationPlatform;
  stop: () => Promise<void>;
}

const TELEGRAM_MAX_MESSAGE = 4096;

function splitTelegramText(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MAX_MESSAGE) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE);
    if (cut < 1000) {
      cut = TELEGRAM_MAX_MESSAGE;
    }
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining.trim().length > 0) {
    parts.push(remaining);
  }

  return parts;
}

export async function startTelegramIntegration(deps: TelegramIntegrationDeps): Promise<RunningIntegration> {
  const bot = new TelegramBot(encodeURIComponent(deps.token), { polling: true });

  const stop = async () => {
    try {
      await bot.stopPolling();
    } catch {
      // ignore
    }
  };

  bot.on("polling_error", (error: any) => {
    deps.log(`[integrations][telegram] polling_error: ${error?.message ?? String(error)}`);
  });

  bot.on("message", async (message: any) => {
    try {
      const text = typeof message?.text === "string" ? message.text : "";
      if (!text) return;

      const chatId = String(message.chat?.id);
      const messageId = String(message.message_id ?? "");
      const timestamp = typeof message.date === "number" ? message.date * 1000 : Date.now();

      const normalized = text.trim();
      const lower = normalized.toLowerCase();

      if (lower === "/help") {
        await bot.sendMessage(
          chatId,
          ["Commands:", "/help", "/status", "/tasks", "", "Just message me to ask anything."].join(
            "\n",
          ),
        );
        return;
      }

      if (lower === "/status") {
        const status = await deps.getStatusText();
        await bot.sendMessage(chatId, status);
        return;
      }

      if (lower === "/tasks") {
        const tasks = await deps.getTasksText();
        await bot.sendMessage(chatId, tasks);
        return;
      }

      await bot.sendChatAction(chatId, "typing").catch(() => { });

      const outgoing = await deps.handleMessage({
        platform: "telegram",
        from: chatId,
        text: normalized,
        messageId,
        timestamp,
      });

      const replyTo = outgoing.replyTo ? Number.parseInt(outgoing.replyTo, 10) : undefined;
      for (const part of splitTelegramText(outgoing.text)) {
        // eslint-disable-next-line no-await-in-loop
        await bot.sendMessage(chatId, part, {
          parse_mode: "Markdown",
          reply_to_message_id: Number.isFinite(replyTo as any) ? replyTo : undefined,
          disable_web_page_preview: true,
        });
      }
    } catch (error) {
      deps.log(
        `[integrations][telegram] message handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  // Validate token and report bot username to logs
  try {
    const me = await bot.getMe();
    deps.log(`[integrations][telegram] started as @${me.username ?? "unknown"}`);
  } catch (error) {
    deps.log(
      `[integrations][telegram] getMe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const platform: IntegrationPlatform = "telegram";
  return { platform, stop };
}
