import type { IntegrationPlatform } from "./auth.js";

export interface RateLimitKey {
  platform: IntegrationPlatform;
  from: string;
}

export class PerUserRateLimiter {
  private readonly lastResponseAt = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  allow(key: RateLimitKey, now: number): boolean {
    const k = `${key.platform}:${key.from}`;
    const prev = this.lastResponseAt.get(k);
    if (typeof prev === "number" && now - prev < this.windowMs) {
      return false;
    }
    this.lastResponseAt.set(k, now);
    return true;
  }
}

