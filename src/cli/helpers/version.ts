import fetch from "node-fetch";
import { readFileSync } from "node:fs";

const REGISTRY_LATEST_URL = "https://registry.npmjs.org/@imisbahk/hive/latest";

export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    const response = await fetch(REGISTRY_LATEST_URL, { signal: controller.signal });
    const latest = (await response.json()) as { version?: string } | undefined;

    if (!latest?.version || typeof latest.version !== "string") {
      return null;
    }

    return latest.version;
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
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

  // Only nag if more than one minor release behind (e.g. 0.1.x -> 0.3.x).
  return rMajor === lMajor && rMinor >= lMinor + 2;
}

function toNumbers(value: string): number[] {
  return value.split(".").map((part) => Number.parseInt(part, 10));
}
