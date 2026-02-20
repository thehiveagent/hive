import keytar from "keytar";

import type { ProviderName } from "./base.js";

const KEYCHAIN_SERVICE = "hive";

export async function resolveProviderApiKey(
  providerName: ProviderName,
  envVarName: string,
): Promise<string | undefined> {
  let keychainValue: string | null = null;
  try {
    keychainValue = await keytar.getPassword(KEYCHAIN_SERVICE, providerName);
  } catch {
    keychainValue = null;
  }

  return (
    keychainValue ??
    process.env[envVarName] ??
    undefined
  );
}
