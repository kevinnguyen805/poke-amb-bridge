/** Fixed-window rate limiter. Async so a Postgres-backed impl drops in unchanged. */
export interface RateLimiter {
  hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private m = new Map<string, { windowStart: number; count: number }>();

  constructor(private nowMs: () => number = () => Date.now()) {}

  async hit(key: string, max: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
    const bucket = Math.floor(this.nowMs() / 1000 / windowSec);
    const cur = this.m.get(key);
    if (!cur || cur.windowStart !== bucket) {
      this.m.set(key, { windowStart: bucket, count: 1 });
      return { allowed: 1 <= max, count: 1 };
    }
    cur.count += 1;
    return { allowed: cur.count <= max, count: cur.count };
  }
}
