import fetch from "node-fetch";
import { readFileSync } from "node:fs";

const REGISTRY_LATEST_URL = "https://registry.npmjs.org/@imisbahk/hive/latest";

export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs),
    );

    const latest = (await Promise.race([
      fetch(REGISTRY_LATEST_URL).then((response) => response.json()),
      timeout,
    ])) as { version?: string } | undefined;

    if (!latest?.version || typeof latest.version !== "string") {
      return null;
    }

    return latest.version;
  } catch {
    return null;
  }
}

export function getLocalVersion(): string {
  try {
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version) {
      return parsed.version;
    }
  } catch {
    // ignore
  }

  return "0.0.0";
}

export function isVersionNewer(remote: string, local: string): boolean {
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

export function isMinorJump(remote: string, local: string): boolean {
  const [rMajor, rMinor] = toNumbers(remote);
  const [lMajor, lMinor] = toNumbers(local);

  if (rMajor > lMajor) {
    return true;
  }

  return rMajor === lMajor && rMinor >= (lMinor + 1);
}

function toNumbers(value: string): number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10));
}
