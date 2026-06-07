import { describe, it, expect } from "vitest";
import { handleShare, type CoreDeps } from "../src/http/core";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import { InMemoryRateLimiter } from "../src/spine/ratelimit";
import { MockMsp } from "../src/spine/msp";
import type { Clock } from "../src/spine/types";

const clock: Clock = { now: () => new Date("2026-06-05T18:00:00.000Z") };

function deps(): CoreDeps {
  return {
    tokens: new InMemoryTokenStore(),
    continuity: new InMemoryContinuityStore(),
    msp: new MockMsp(),
    clock,
    businessUuid: "u",
    scopedKey: "k",
    mspSecret: "s",
    rateLimiter: new InMemoryRateLimiter(() => 0),
  };
}

const body = JSON.stringify({ payload: { kind: "url", url: "https://x.com" } });
const hdr = (ip: string) => ({ "x-poke-key": "k", "content-type": "application/json", "x-forwarded-for": ip });

describe("handleShare rate limiting", () => {
  it("returns 429 once the per-IP limit (30/min) is exceeded", async () => {
    const d = deps();
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await handleShare(d, hdr("1.2.3.4"), body)).status;
    expect(last).toBe(201);
    expect((await handleShare(d, hdr("1.2.3.4"), body)).status).toBe(429);
  });

  it("limits each IP independently", async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) await handleShare(d, hdr("1.1.1.1"), body);
    expect((await handleShare(d, hdr("1.1.1.1"), body)).status).toBe(429);
    expect((await handleShare(d, hdr("9.9.9.9"), body)).status).toBe(201);
  });

  it("does not rate-limit when no limiter is configured (existing behavior preserved)", async () => {
    const d = deps();
    delete d.rateLimiter;
    for (let i = 0; i < 40; i++) {
      expect((await handleShare(d, hdr("1.2.3.4"), body)).status).toBe(201);
    }
  });
});
