import keytar from "keytar";

const KEYCHAIN_SERVICE = "hive";

export type KeychainAccount =
  | "telegram"
  | "discord"
  | "slack"
  | "slack_client"
  | "slack_signing"
  | "slack_owner"
  | "telegram_owner"
  | "discord_owner"
  | "slack_owner_id";

export async function keychainSet(account: string, secret: string): Promise<void> {
  await keytar.setPassword(KEYCHAIN_SERVICE, account, secret);
}

export async function keychainGet(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(KEYCHAIN_SERVICE, account);
  } catch {
    return null;
  }
}

export async function keychainDelete(account: string): Promise<void> {
  try {
    await keytar.deletePassword(KEYCHAIN_SERVICE, account);
  } catch {
    // ignore
  }
}

