import type { IncomingMessage } from "./handler.js";
import type { IntegrationPlatform } from "./auth.js";

export interface SlackTokens {
  botToken: string; // xoxb-...
  appToken?: string; // xapp-... (socket mode)
  signingSecret?: string;
}

export interface SlackIntegrationDeps {
  tokens: SlackTokens;
  handleIncoming: (msg: IncomingMessage) => Promise<string>;
  log: (line: string) => void;
  getTasksText: () => Promise<string>;
  getStatusText: () => Promise<string>;
}

export interface RunningIntegration {
  platform: IntegrationPlatform;
  stop: () => Promise<void>;
}

export async function startSlackIntegration(deps: SlackIntegrationDeps): Promise<RunningIntegration> {
  const { App } = (await import("@slack/bolt")) as any;

  const socketMode = Boolean(deps.tokens.appToken);
  const app = new App({
    token: deps.tokens.botToken,
    appToken: deps.tokens.appToken,
    signingSecret: deps.tokens.signingSecret ?? "hive-signing-secret",
    socketMode,
  });

  const postBlocks = async (channel: string, text: string) => {
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ];
    await app.client.chat.postMessage({ channel, text, blocks });
  };

  app.command("/hive", async ({ command, ack }: any) => {
    await ack();
    try {
      const result = await deps.handleIncoming({
        platform: "slack",
        from: String(command.user_id),
        text: String(command.text ?? "").trim(),
        messageId: String(command.trigger_id ?? ""),
        timestamp: Date.now(),
      });
      await postBlocks(String(command.channel_id), result);
    } catch (error) {
      deps.log(`[integrations][slack] /hive error: ${String(error)}`);
    }
  });

  app.event("app_mention", async ({ event }: any) => {
    try {
      const channel = String(event.channel);
      const user = String(event.user);
      const text = String(event.text ?? "").replace(/<@[^>]+>/g, "").trim();
      if (!text) return;

      const result = await deps.handleIncoming({
        platform: "slack",
        from: user,
        text,
        messageId: String(event.ts ?? ""),
        timestamp: Date.now(),
      });

      await postBlocks(channel, result);
    } catch (error) {
      deps.log(`[integrations][slack] mention error: ${String(error)}`);
    }
  });

  app.message(async ({ message, say }: any) => {
    try {
      if (message.subtype) return;
      if (message.channel_type !== "im") return;
      const user = String(message.user);
      const text = String(message.text ?? "").trim();
      if (!text) return;

      const result = await deps.handleIncoming({
        platform: "slack",
        from: user,
        text,
        messageId: String(message.ts ?? ""),
        timestamp: Date.now(),
      });

      await say({
        text: result,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: result },
          },
        ],
      });
    } catch (error) {
      deps.log(`[integrations][slack] dm error: ${String(error)}`);
    }
  });

  await app.start();
  deps.log("[integrations][slack] started");

  const platform: IntegrationPlatform = "slack";
  const stop = async () => {
    try {
      await app.stop();
    } catch {
      // ignore
    }
  };

  return { platform, stop };
}

