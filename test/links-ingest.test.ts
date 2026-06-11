import { describe, it, expect } from "vitest";
import { handleLinkIngest, type CoreDeps } from "../src/http/core";
import { mintIngestToken } from "../src/links/ingestToken";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import { InMemoryRateLimiter } from "../src/spine/ratelimit";
import { MockMsp } from "../src/spine/msp";
import type { Clock } from "../src/spine/types";
import type { SavedLink } from "../src/links/store";

const clock: Clock = { now: () => new Date("2026-06-09T18:00:00.000Z") };

/** Build deps with a mock saveLink so the endpoint is exercised with no database. */
function makeDeps(overrides: Partial<CoreDeps> = {}) {
  const calls: Array<{ userId: string; url: string; note?: string; tags?: string[] }> = [];
  const saveLink = async (
    userId: string,
    url: string,
    note?: string,
    tags?: string[],
  ): Promise<SavedLink> => {
    calls.push({ userId, url, note, tags });
    return { id: calls.length, url, note, tags, createdAt: clock.now().toISOString() };
  };
  const deps: CoreDeps = {
    tokens: new InMemoryTokenStore(),
    continuity: new InMemoryContinuityStore(),
    msp: new MockMsp(),
    clock,
    businessUuid: "u",
    scopedKey: "k",
    mspSecret: "s",
    rateLimiter: new InMemoryRateLimiter(() => 0),
    saveLink,
    ...overrides,
  };
  return { deps, calls };
}

const auth = (extra: Record<string, string> = {}): Record<string, string> => ({
  "x-poke-key": "k",
  "content-type": "application/json",
  "x-forwarded-for": "1.2.3.4",
  ...extra,
});

describe("handleLinkIngest", () => {
  it("rejects an unauthenticated request with 401 and never writes", async () => {
    const { deps, calls } = makeDeps();
    const r = await handleLinkIngest(
      deps,
      { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      JSON.stringify({ url: "https://example.com" }),
    );
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects a wrong scoped key with 401", async () => {
    const { deps } = makeDeps();
    const r = await handleLinkIngest(deps, auth({ "x-poke-key": "WRONG" }), JSON.stringify({ url: "https://example.com" }));
    expect(r.status).toBe(401);
  });

  it("requires a url (400 when missing)", async () => {
    const { deps, calls } = makeDeps();
    const r = await handleLinkIngest(deps, auth(), JSON.stringify({ note: "no url here" }));
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-http(s) url scheme with 400 (stored-value guard, not a fetch)", async () => {
    const { deps, calls } = makeDeps();
    const r = await handleLinkIngest(deps, auth(), JSON.stringify({ url: "javascript:alert(1)" }));
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid json with 400", async () => {
    const { deps } = makeDeps();
    const r = await handleLinkIngest(deps, auth(), "{not valid json");
    expect(r.status).toBe(400);
  });

  it("saves a valid link and returns 201 with the saved record", async () => {
    const { deps, calls } = makeDeps();
    const r = await handleLinkIngest(
      deps,
      auth({ "x-poke-user-id": "user-42" }),
      JSON.stringify({ url: "https://example.com/a", note: "read later", tags: ["news", "ai"] }),
    );
    expect(r.status).toBe(201);
    expect(calls).toEqual([
      { userId: "user-42", url: "https://example.com/a", note: "read later", tags: ["news", "ai"] },
    ]);
    expect((r.json as { saved: SavedLink }).saved.url).toBe("https://example.com/a");
  });

  it("defaults the user to anonymous when no user id is provided", async () => {
    const { deps, calls } = makeDeps();
    await handleLinkIngest(deps, auth(), JSON.stringify({ url: "https://example.com" }));
    expect(calls[0]!.userId).toBe("anonymous");
  });

  it("scopes to the session principal's poke account id when bearer-authed", async () => {
    const { deps, calls } = makeDeps();
    await handleLinkIngest(
      deps,
      { authorization: "Bearer session_acc-9", "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      JSON.stringify({ url: "https://example.com" }),
    );
    expect(calls[0]!.userId).toBe("acc-9");
  });

  it("returns 429 once the per-IP rate limit is exceeded", async () => {
    const { deps } = makeDeps();
    let last = 0;
    for (let i = 0; i < 60; i++) {
      last = (await handleLinkIngest(deps, auth(), JSON.stringify({ url: "https://example.com" }))).status;
    }
    expect(last).toBe(201);
    expect((await handleLinkIngest(deps, auth(), JSON.stringify({ url: "https://example.com" }))).status).toBe(429);
  });

  it("does not rate-limit when no limiter is configured", async () => {
    const { deps } = makeDeps({ rateLimiter: undefined });
    for (let i = 0; i < 80; i++) {
      expect((await handleLinkIngest(deps, auth(), JSON.stringify({ url: "https://example.com" }))).status).toBe(201);
    }
  });

  it("returns 503 (not a raw 500) when the link store write fails", async () => {
    const { deps } = makeDeps({
      saveLink: async () => {
        throw new Error("DATABASE_URL not configured");
      },
    });
    const r = await handleLinkIngest(deps, auth(), JSON.stringify({ url: "https://example.com" }));
    expect(r.status).toBe(503);
  });
});

describe("handleLinkIngest with per-user spk_ tokens (Save to Poke)", () => {
  const UID = "4c542392-0000-0000-0000-000000000000";

  it("accepts a valid token and scopes the save to the token's bound user", async () => {
    const { deps, calls } = makeDeps({ ingestTokenSecret: "tsecret" });
    const token = await mintIngestToken("tsecret", UID);
    const r = await handleLinkIngest(
      deps,
      { "x-poke-key": token, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      JSON.stringify({ url: "https://example.com/a" }),
    );
    expect(r.status).toBe(201);
    expect(calls[0]!.userId).toBe(UID);
  });

  it("ignores a spoofed x-poke-user-id header — the token IS the identity", async () => {
    const { deps, calls } = makeDeps({ ingestTokenSecret: "tsecret" });
    const token = await mintIngestToken("tsecret", UID);
    await handleLinkIngest(
      deps,
      {
        "x-poke-key": token,
        "x-poke-user-id": "someone-else",
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
      },
      JSON.stringify({ url: "https://example.com/a" }),
    );
    expect(calls[0]!.userId).toBe(UID);
  });

  it("rejects a token minted under a different secret with 401 and never writes", async () => {
    const { deps, calls } = makeDeps({ ingestTokenSecret: "tsecret" });
    const token = await mintIngestToken("WRONG", UID);
    const r = await handleLinkIngest(
      deps,
      { "x-poke-key": token, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      JSON.stringify({ url: "https://example.com/a" }),
    );
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the scoped key as the token secret when none is configured", async () => {
    const { deps, calls } = makeDeps(); // scopedKey "k", no ingestTokenSecret
    const token = await mintIngestToken("k", UID);
    const r = await handleLinkIngest(
      deps,
      { "x-poke-key": token, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      JSON.stringify({ url: "https://example.com/a" }),
    );
    expect(r.status).toBe(201);
    expect(calls[0]!.userId).toBe(UID);
  });

  it("keeps the legacy shared-key + header path working unchanged", async () => {
    const { deps, calls } = makeDeps({ ingestTokenSecret: "tsecret" });
    const r = await handleLinkIngest(
      deps,
      auth({ "x-poke-user-id": "legacy-user" }),
      JSON.stringify({ url: "https://example.com/a" }),
    );
    expect(r.status).toBe(201);
    expect(calls[0]!.userId).toBe("legacy-user");
  });
});
