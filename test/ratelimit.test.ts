import { describe, it, expect } from "vitest";
import { InMemoryRateLimiter } from "../src/spine/ratelimit";

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit, then blocks within the same window", async () => {
    let t = 1_000_000;
    const rl = new InMemoryRateLimiter(() => t);
    const allowed: boolean[] = [];
    for (let i = 0; i < 4; i++) allowed.push((await rl.hit("ip:1", 3, 60)).allowed);
    expect(allowed).toEqual([true, true, true, false]);
  });

  it("resets when the window rolls over", async () => {
    let t = 0;
    const rl = new InMemoryRateLimiter(() => t);
    expect((await rl.hit("ip:1", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("ip:1", 1, 60)).allowed).toBe(false);
    t = 61_000; // next 60s window
    expect((await rl.hit("ip:1", 1, 60)).allowed).toBe(true);
  });

  it("tracks keys independently", async () => {
    const rl = new InMemoryRateLimiter(() => 0);
    expect((await rl.hit("a", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("b", 1, 60)).allowed).toBe(true);
    expect((await rl.hit("a", 1, 60)).allowed).toBe(false);
  });
});
