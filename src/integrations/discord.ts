import type { IncomingMessage } from "./handler.js";
import type { IntegrationPlatform } from "./auth.js";
import * as discordPkg from "discord.js";
const { Client, GatewayIntentBits, Partials, AttachmentBuilder, SlashCommandBuilder } = discordPkg as any;

export interface DiscordIntegrationDeps {
  token: string;
  handleIncoming: (msg: IncomingMessage, reply: (text: string) => Promise<void>) => Promise<void>;
  log: (line: string) => void;
}

export interface RunningIntegration {
  platform: IntegrationPlatform;
  stop: () => Promise<void>;
}

const DISCORD_MAX_MESSAGE = 2000;

function chunk(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    parts.push(remaining.slice(0, max));
    remaining = remaining.slice(max);
  }
  if (remaining.length) parts.push(remaining);
  return parts;
}

export async function startDiscordIntegration(deps: DiscordIntegrationDeps): Promise<RunningIntegration> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on("error", (error: any) => {
    deps.log(`[integrations][discord] error: ${error?.message ?? String(error)}`);
  });

  client.on("ready", async () => {
    deps.log(`[integrations][discord] ready as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("messageCreate", async (message: any) => {
    try {
      if (!message || message.author?.bot) return;
      const content = typeof message.content === "string" ? message.content : "";
      if (!content.trim()) return;

      const isDm = message.channel?.type === 1; // DM
      const mentioned = !isDm && client.user ? message.mentions?.has(client.user) : false;
      if (!isDm && !mentioned) return;

      const cleaned = mentioned && client.user
        ? content.replaceAll(`<@${client.user.id}>`, "").trim()
        : content.trim();

      const reply = async (text: string) => {
        if (text.length <= DISCORD_MAX_MESSAGE) {
          for (const part of chunk(text, DISCORD_MAX_MESSAGE)) {
            // eslint-disable-next-line no-await-in-loop
            await message.reply(part);
          }
          return;
        }

        const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), {
          name: "hive-response.txt",
        });
        await message.reply({ files: [attachment] });
      };

      await deps.handleIncoming(
        {
          platform: "discord",
          from: String(message.author?.id ?? ""),
          text: cleaned,
          messageId: String(message.id ?? ""),
          timestamp: Date.now(),
        },
        reply,
      );
    } catch (error) {
      deps.log(
        `[integrations][discord] message handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  // Slash commands (best-effort; registration should be handled by setup command)
  client.on("interactionCreate", async (interaction: any) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      if (interaction.commandName !== "ask" && interaction.commandName !== "tasks" && interaction.commandName !== "status") {
        return;
      }

      const replyText = async (text: string) => {
        if (text.length <= DISCORD_MAX_MESSAGE) {
          await interaction.reply({ content: text, ephemeral: true });
          return;
        }
        const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "hive-response.txt" });
        await interaction.reply({ files: [attachment], ephemeral: true });
      };

      if (interaction.commandName === "ask") {
        const question = String(interaction.options?.getString?.("question") ?? "").trim();
        if (!question) {
          await replyText("Usage: /ask <question>");
          return;
        }
        await deps.handleIncoming(
          {
            platform: "discord",
            from: String(interaction.user?.id ?? ""),
            text: question,
            messageId: String(interaction.id ?? ""),
            timestamp: Date.now(),
          },
          replyText,
        );
        return;
      }

      await replyText("Not implemented yet in this build.");
    } catch (error) {
      deps.log(
        `[integrations][discord] interaction error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  await client.login(deps.token);

  const platform: IntegrationPlatform = "discord";
  const stop = async () => {
    try {
      await client.destroy();
    } catch {
      // ignore
    }
  };

  return { platform, stop };
}

export async function buildDiscordSlashCommandData(): Promise<unknown[]> {
  // Returned shape used by setup command with REST registration.
  // Keeping this helper here avoids duplicating definitions.
  const tasks = new SlashCommandBuilder().setName("tasks").setDescription("Show Hive tasks");
  const status = new SlashCommandBuilder().setName("status").setDescription("Show Hive status");
  const ask = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the Hive")
    .addStringOption((opt: any) =>
      opt.setName("question").setDescription("Your question").setRequired(true),
    );
  return [tasks.toJSON(), status.toJSON(), ask.toJSON()];
}
