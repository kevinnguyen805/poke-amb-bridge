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
  it("round-trips put/get", () => {
    const s = new InMemoryTokenStore();
    s.put(rec("t1"));
    expect(s.get("t1")?.intent).toBe("share");
    expect(s.get("missing")).toBeUndefined();
  });

  it("consume on an unconsumed token WINS the CAS and stamps consumedAt/consumedBy", () => {
    const s = new InMemoryTokenStore();
    s.put(rec("t2"));
    const r = s.consume("t2", "opaqueA", "2026-06-05T18:01:00.000Z");
    expect(r.status).toBe("won");
    expect(s.get("t2")?.consumedBy).toBe("opaqueA");
    expect(s.get("t2")?.consumedAt).toBe("2026-06-05T18:01:00.000Z");
  });

  it("a second consume by the SAME opaqueId is a replay (branch 2c)", () => {
    const s = new InMemoryTokenStore();
    s.put(rec("t3"));
    s.consume("t3", "opaqueA", "2026-06-05T18:01:00.000Z");
    expect(s.consume("t3", "opaqueA", "2026-06-05T18:02:00.000Z").status).toBe("replay");
  });

  it("a consume by a DIFFERENT opaqueId after consumption is foreign — rejected (branch 2b)", () => {
    const s = new InMemoryTokenStore();
    s.put(rec("t4"));
    s.consume("t4", "opaqueA", "2026-06-05T18:01:00.000Z");
    const r = s.consume("t4", "opaqueB", "2026-06-05T18:03:00.000Z");
    expect(r.status).toBe("foreign");
    expect(s.get("t4")?.consumedBy).toBe("opaqueA"); // unchanged
  });

  it("consume of a missing token reports missing", () => {
    const s = new InMemoryTokenStore();
    expect(s.consume("nope", "opaqueA", "2026-06-05T18:01:00.000Z").status).toBe("missing");
  });

  it("only one of two concurrent consumers wins; the other is foreign", () => {
    const s = new InMemoryTokenStore();
    s.put(rec("t5"));
    const a = s.consume("t5", "opaqueA", "2026-06-05T18:01:00.000Z");
    const b = s.consume("t5", "opaqueB", "2026-06-05T18:01:00.000Z");
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

  it("round-trips and is keyed on opaqueId", () => {
    const s = new InMemoryContinuityStore();
    s.put(link("opaqueA"));
    expect(s.get("opaqueA")?.linkedVia).toBe("share");
    expect(s.get("opaqueZ")).toBeUndefined();
  });
});
