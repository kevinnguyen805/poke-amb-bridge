import { describe, it, expect } from "vitest";
import { InMemoryTokenStore, InMemoryContinuityStore } from "../src/spine/store";
import type { ShareTokenRecord, ContinuityLink } from "../src/spine/types";

function rec(token: string): ShareTokenRecord {
  return {
    token,
    tokenClass: "anonymous",
    intent: "share",
    linkSource: "shortcut",
    payload: { kind: "url", url: "https://example.com" },
    createdAt: "2026-06-05T18:00:00.000Z",
    expiresAt: "2026-06-05T18:15:00.000Z",
    ttl: 900,
  };
}

describe("InMemoryTokenStore", () => {
  it("round-trips put/get", async () => {
    const s = new InMemoryTokenStore();
    await s.put(rec("t1"));
    expect((await s.get("t1"))?.intent).toBe("share");
    expect(await s.get("missing")).toBeUndefined();
  });

  it("consume on an unconsumed token WINS the CAS and stamps consumedAt/consumedBy", async () => {
    const s = new InMemoryTokenStore();
    await s.put(rec("t2"));
    const r = await s.consume("t2", "opaqueA", "2026-06-05T18:01:00.000Z");
    expect(r.status).toBe("won");
    expect((await s.get("t2"))?.consumedBy).toBe("opaqueA");
    expect((await s.get("t2"))?.consumedAt).toBe("2026-06-05T18:01:00.000Z");
  });

  it("a second consume by the SAME opaqueId is a replay (branch 2c)", async () => {
    const s = new InMemoryTokenStore();
    await s.put(rec("t3"));
    await s.consume("t3", "opaqueA", "2026-06-05T18:01:00.000Z");
    expect((await s.consume("t3", "opaqueA", "2026-06-05T18:02:00.000Z")).status).toBe("replay");
  });

  it("a consume by a DIFFERENT opaqueId after consumption is foreign — rejected (branch 2b)", async () => {
    const s = new InMemoryTokenStore();
    await s.put(rec("t4"));
    await s.consume("t4", "opaqueA", "2026-06-05T18:01:00.000Z");
    const r = await s.consume("t4", "opaqueB", "2026-06-05T18:03:00.000Z");
    expect(r.status).toBe("foreign");
    expect((await s.get("t4"))?.consumedBy).toBe("opaqueA");
  });

  it("consume of a missing token reports missing", async () => {
    const s = new InMemoryTokenStore();
    expect((await s.consume("nope", "opaqueA", "2026-06-05T18:01:00.000Z")).status).toBe("missing");
  });

  it("only one of two consumers wins; the other is foreign", async () => {
    const s = new InMemoryTokenStore();
    await s.put(rec("t5"));
    const a = await s.consume("t5", "opaqueA", "2026-06-05T18:01:00.000Z");
    const b = await s.consume("t5", "opaqueB", "2026-06-05T18:01:00.000Z");
    expect(a.status).toBe("won");
    expect(b.status).toBe("foreign");
  });
});

describe("InMemoryContinuityStore", () => {
  const link = (opaqueId: string): ContinuityLink => ({
    opaqueId,
    agentState: "agent",
    firstLinkedAt: "2026-06-05T18:00:00.000Z",
    lastSeenAt: "2026-06-05T18:00:00.000Z",
    lastInboundAt: "2026-06-05T18:00:00.000Z",
    linkedVia: "share",
    linkSource: "shortcut",
  });

  it("round-trips and is keyed on opaqueId", async () => {
    const s = new InMemoryContinuityStore();
    await s.put(link("opaqueA"));
    expect((await s.get("opaqueA"))?.linkedVia).toBe("share");
    expect(await s.get("opaqueZ")).toBeUndefined();
  });
});
