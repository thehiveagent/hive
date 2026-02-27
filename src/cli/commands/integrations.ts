import type { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  addAuthorized,
  isDisabled,
  listPendingAuth,
  readAuthorizedConfig,
  removeAuthorized,
  setDisabled,
  type IntegrationPlatform,
} from "../../integrations/auth.js";
import { keychainSet } from "../../integrations/keychain.js";
import { getHiveHomeDir } from "../../storage/db.js";
import { renderHiveHeader, renderInfo, renderStep, renderSuccess } from "../ui.js";

const PLATFORMS: IntegrationPlatform[] = ["telegram", "whatsapp", "discord", "slack"];

export function registerIntegrationsCommand(program: Command): void {
  const cmd = program.command("integrations").description("Messaging integrations");

  cmd
    .command("list")
    .description("Show all integrations and status")
    .action(async () => {
      await runIntegrationsList();
    });

  cmd
    .command("telegram")
    .description("Telegram integration commands")
    .command("setup")
    .description("Setup Telegram bot")
    .action(async () => {
      await runTelegramSetup();
    });

  cmd
    .command("whatsapp")
    .description("WhatsApp integration commands")
    .command("setup")
    .description("Setup WhatsApp session via QR")
    .action(async () => {
      await runWhatsAppSetup();
    });

  cmd
    .command("discord")
    .description("Discord integration commands")
    .command("setup")
    .description("Setup Discord bot")
    .action(async () => {
      await runDiscordSetup();
    });

  cmd
    .command("slack")
    .description("Slack integration commands")
    .command("setup")
    .description("Setup Slack app")
    .action(async () => {
      await runSlackSetup();
    });

  const auth = cmd.command("auth").description("Authorization management");
  auth
    .command("list")
    .description("Show authorized users + pending requests")
    .action(() => {
      renderHiveHeader("Integrations · Auth");
      const config = readAuthorizedConfig();
      const pending = listPendingAuth();

      for (const platform of PLATFORMS) {
        const ids = config[platform] ?? [];
        renderInfo(`${platform}: ${ids.length ? ids.join(", ") : "—"}`);
      }

      if (pending.length) {
        console.log("");
        renderInfo(`${pending.length} pending request(s):`);
        for (const req of pending) {
          renderInfo(
            `· ${req.from} on ${req.platform} (last: ${new Date(req.lastSeenAt).toLocaleString()})`,
          );
        }
      }
    });

  auth
    .command("add")
    .description("Authorize a user")
    .argument("<platform>", "telegram|whatsapp|discord|slack")
    .argument("<id>", "user id / phone / external id")
    .action((platform: string, id: string) => {
      const p = parsePlatform(platform);
      addAuthorized(p, id);
      renderSuccess(`Authorized ${id} on ${p}.`);
    });

  auth
    .command("remove")
    .description("Revoke authorization")
    .argument("<platform>", "telegram|whatsapp|discord|slack")
    .argument("<id>", "user id / phone / external id")
    .action((platform: string, id: string) => {
      const p = parsePlatform(platform);
      removeAuthorized(p, id);
      renderSuccess(`Removed ${id} from ${p}.`);
    });

  cmd
    .command("disable")
    .description("Disable an integration without removing config")
    .argument("<platform>", "telegram|whatsapp|discord|slack")
    .action(async (platform: string) => {
      const p = parsePlatform(platform);
      setDisabled(p, true);
      renderSuccess(`${p} disabled.`);
      await tryReloadDaemonIntegrations();
    });

  cmd
    .command("enable")
    .description("Enable a disabled integration")
    .argument("<platform>", "telegram|whatsapp|discord|slack")
    .action(async (platform: string) => {
      const p = parsePlatform(platform);
      setDisabled(p, false);
      renderSuccess(`${p} enabled.`);
      await tryReloadDaemonIntegrations();
    });

  cmd.action(() => {
    renderHiveHeader("Integrations");
    cmd.outputHelp();
  });
}

function parsePlatform(raw: string): IntegrationPlatform {
  const p = raw.trim().toLowerCase();
  if (p === "telegram" || p === "whatsapp" || p === "discord" || p === "slack") {
    return p;
  }
  throw new Error(`Unknown platform: ${raw}`);
}

function readNumber(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const v = Number.parseInt(raw, 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function tryReloadDaemonIntegrations(): Promise<void> {
  const home = getHiveHomeDir();
  const port = readNumber(join(home, "daemon.port")) ?? 2718;

  await new Promise<void>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "integrations_reload" }) + "\n");
    });

    socket.on("data", () => {
      socket.end();
      resolve();
    });

    socket.on("error", () => resolve());
    socket.setTimeout(500, () => resolve());
  });
}

async function runIntegrationsList(): Promise<void> {
  renderHiveHeader("Integrations");

  const home = getHiveHomeDir();
  const port = readNumber(join(home, "daemon.port")) ?? 2718;

  const daemonStatus = await getDaemonStatusViaTcp(port);
  const liveIntegrations = (daemonStatus?.integrations ?? null) as
    | Record<string, string>
    | null
    | undefined;

  for (const platform of PLATFORMS) {
    const disabled = isDisabled(platform);
    const live = liveIntegrations?.[platform];
    const label = disabled ? chalk.gray("disabled") : live ? live : chalk.gray("unknown");
    console.log(`- ${platform.padEnd(8)} ${label}`);
  }

  const pending = listPendingAuth();
  if (pending.length) {
    console.log("");
    renderInfo(`${pending.length} authorization request(s) pending (run \`hive integrations auth list\`).`);
  }
}

function getDaemonStatusViaTcp(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify({ type: "status" }) + "\n");
    });

    let buffer = "";
    let responded = false;

    socket.on("data", (data: Buffer) => {
      if (responded) {
        return;
      }
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

    socket.on("error", () => resolve(null));
    socket.setTimeout(500, () => resolve(null));
  });
}

async function runTelegramSetup(): Promise<void> {
  renderHiveHeader("Integrations · Telegram Setup");
  renderInfo("1) Open Telegram and talk to @BotFather to create a bot.");
  renderInfo("2) Copy the bot token.");

  const answers = (await inquirer.prompt([
    {
      type: "password",
      name: "token",
      message: "Bot token:",
      mask: "*",
      validate: (v: string) => {
        const trimmed = String(v ?? "").trim();
        if (!trimmed.length) {
          return "Token is required.";
        }
        if (/\s/.test(trimmed)) {
          return "Token cannot contain spaces.";
        }
        return true;
      },
    },
    {
      type: "input",
      name: "ownerId",
      message: "Your Telegram chat/user ID (for authorization):",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Owner ID is required."),
    },
  ])) as { token: string; ownerId: string };

  const token = answers.token.trim();
  const ownerId = answers.ownerId.trim();

  const spinner = ora("Saving Telegram token...").start();
  await keychainSet("telegram", token);
  spinner.succeed("Token saved to keychain.");

  // Test token
  const test = ora("Testing Telegram bot token...").start();
  try {
    const TelegramBot = (await import("node-telegram-bot-api")).default;
    const bot = new TelegramBot(encodeURIComponent(token), { polling: false });
    const me = await bot.getMe();
    test.succeed(`Connected as @${me.username ?? "unknown"}`);
  } catch (error) {
    test.fail("Token test failed.");
    throw error;
  }

  addAuthorized("telegram", ownerId);
  renderSuccess(`Authorized owner ID ${ownerId} for Telegram.`);
  renderStep("Run `hive daemon restart` to boot the Telegram integration.");
}

async function runWhatsAppSetup(): Promise<void> {
  renderHiveHeader("Integrations · WhatsApp Setup");
  renderInfo("This uses WhatsApp Web (headless Chrome) and a QR code.");

  const home = getHiveHomeDir();
  const sessionDir = join(home, "integrations", "whatsapp", "session");

  const spinner = ora("Starting WhatsApp QR setup...").start();
  try {
    const { runWhatsAppSetup } = await import("../../integrations/whatsapp.js");
    spinner.stop();
    await runWhatsAppSetup(sessionDir, (line) => renderInfo(line));
    renderSuccess("WhatsApp setup complete.");
    renderStep("Run `hive daemon restart` to boot the WhatsApp integration.");
  } catch (error) {
    spinner.fail("WhatsApp setup failed.");
    throw error;
  }
}

async function runDiscordSetup(): Promise<void> {
  renderHiveHeader("Integrations · Discord Setup");

  const answers = (await inquirer.prompt([
    {
      type: "password",
      name: "token",
      message: "Discord bot token:",
      mask: "*",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Token is required."),
    },
    {
      type: "input",
      name: "guildId",
      message: "Guild ID (server) to register slash commands:",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Guild ID is required."),
    },
    {
      type: "input",
      name: "ownerId",
      message: "Your Discord user ID (for authorization):",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Owner ID is required."),
    },
  ])) as { token: string; ownerId: string; guildId: string };

  const token = answers.token.trim();
  const guildId = answers.guildId.trim();

  await keychainSet("discord", token);
  await keychainSet("discord_guild", guildId);
  addAuthorized("discord", answers.ownerId.trim());
  renderSuccess("Discord token saved and owner authorized.");

  const spinner = ora("Registering Discord slash commands...").start();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discord = (await import("discord.js")) as any;
    const { Client, GatewayIntentBits, REST, Routes } = discord;

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const appId = await new Promise<string>((resolve, reject) => {
      client.once("ready", () => resolve(String(client.application?.id ?? "")));
      client.once("error", (err: Error) => reject(err));
      client.login(token).catch(reject);
    });

    if (!appId) {
      throw new Error("Could not resolve application ID for slash command registration.");
    }

    const commands = await (await import("../../integrations/discord.js")).buildDiscordSlashCommandData();
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });

    try {
      await client.destroy();
    } catch {
      // ignore
    }

    spinner.succeed("Slash commands registered: /tasks /status /ask");
  } catch (error) {
    spinner.fail("Failed to register slash commands (mentions/DMs still work).");
    renderInfo(String(error));
  }

  renderStep("Run `hive daemon restart` to boot the Discord integration.");
}

async function runSlackSetup(): Promise<void> {
  renderHiveHeader("Integrations · Slack Setup");
  renderInfo("Socket Mode is recommended for local development.");

  const answers = (await inquirer.prompt([
    {
      type: "password",
      name: "botToken",
      message: "Slack bot token (xoxb-...):",
      mask: "*",
      validate: (v: string) => (String(v ?? "").trim().startsWith("xoxb-") ? true : "Expected xoxb- token."),
    },
    {
      type: "password",
      name: "appToken",
      message: "Slack app token (xapp-..., for Socket Mode):",
      mask: "*",
      validate: (v: string) => (String(v ?? "").trim().startsWith("xapp-") ? true : "Expected xapp- token."),
    },
    {
      type: "password",
      name: "signingSecret",
      message: "Slack signing secret:",
      mask: "*",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Signing secret is required."),
    },
    {
      type: "input",
      name: "ownerId",
      message: "Your Slack user ID (for authorization):",
      validate: (v: string) => (String(v ?? "").trim().length ? true : "Owner ID is required."),
    },
  ])) as { botToken: string; appToken: string; signingSecret: string; ownerId: string };

  await keychainSet(
    "slack",
    JSON.stringify({
      botToken: answers.botToken.trim(),
      appToken: answers.appToken.trim(),
      signingSecret: answers.signingSecret.trim(),
    }),
  );
  addAuthorized("slack", answers.ownerId.trim());
  renderSuccess("Slack tokens saved and owner authorized.");
  renderStep("Run `hive daemon restart` to boot the Slack integration.");
}
