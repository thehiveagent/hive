import * as fs from "node:fs";
import * as path from "node:path";

import type { IncomingMessage } from "./handler.js";
import type { IntegrationPlatform } from "./auth.js";

export interface WhatsAppIntegrationDeps {
  sessionDir: string;
  handleMessage: (msg: IncomingMessage) => Promise<{ text: string }>;
  log: (line: string) => void;
  agentName: string;
}

export interface RunningIntegration {
  platform: IntegrationPlatform;
  stop: () => Promise<void>;
}

export async function startWhatsAppIntegration(
  deps: WhatsAppIntegrationDeps,
): Promise<RunningIntegration> {
  const { Client, LocalAuth } = (await import("whatsapp-web.js")) as any;

  if (!fs.existsSync(deps.sessionDir)) {
    fs.mkdirSync(deps.sessionDir, { recursive: true });
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: deps.sessionDir,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("ready", () => deps.log("[integrations][whatsapp] ready"));
  client.on("auth_failure", (msg: any) =>
    deps.log(`[integrations][whatsapp] auth_failure: ${String(msg)}`),
  );
  client.on("disconnected", (reason: any) =>
    deps.log(`[integrations][whatsapp] disconnected: ${String(reason)}`),
  );

  client.on("message", async (message: any) => {
    try {
      const body = typeof message?.body === "string" ? message.body : "";
      if (!body) return;
      const from = typeof message?.from === "string" ? message.from : "";
      if (!from) return;

      await client.sendStateTyping(from).catch(() => {});

      const outgoing = await deps.handleMessage({
        platform: "whatsapp",
        from,
        text: body.trim(),
        messageId: String(message?.id?._serialized ?? message?.id ?? ""),
        timestamp: Date.now(),
      });

      const response = `${deps.agentName}: ${outgoing.text}`;
      await client.sendMessage(from, response);
    } catch (error) {
      deps.log(
        `[integrations][whatsapp] message handler error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  await client.initialize();

  const platform: IntegrationPlatform = "whatsapp";
  const stop = async () => {
    try {
      await client.destroy();
    } catch {
      // ignore
    }
  };

  return { platform, stop };
}

export async function runWhatsAppSetup(sessionDir: string, log: (line: string) => void): Promise<void> {
  const { Client, LocalAuth } = (await import("whatsapp-web.js")) as any;
  const qrcode = (await import("qrcode-terminal")) as any;

  fs.mkdirSync(sessionDir, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", (qr: string) => {
    log("Scan this QR code in WhatsApp (Linked devices):");
    qrcode.generate(qr, { small: true });
  });

  await new Promise<void>((resolve, reject) => {
    client.on("ready", () => resolve());
    client.on("auth_failure", (msg: any) => reject(new Error(String(msg))));
    client.initialize().catch(reject);
  });

  log("WhatsApp session saved.");

  try {
    await client.destroy();
  } catch {
    // ignore
  }
}
