import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { PgTokenStore, PgContinuityStore, migrate, type Sql } from "../src/store/pg";
import type { ShareTokenRecord, ContinuityLink } from "../src/spine/types";

function makeSql(): Sql {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return (text: string, params: unknown[] = []) => pool.query(text, params);
}

function rec(token: string, over: Partial<ShareTokenRecord> = {}): ShareTokenRecord {
  return {
    token,
    tokenClass: "anonymous",
    intent: "share",
    linkSource: "shortcut",
    payload: { kind: "url", url: "https://example.com" },
    createdAt: "2026-06-05T18:00:00.000Z",
    expiresAt: "2026-06-05T18:15:00.000Z",
    ttl: 900,
    ...over,
  };
}

function link(opaqueId: string, over: Partial<ContinuityLink> = {}): ContinuityLink {
  return {
    opaqueId,
    agentState: "agent",
    firstLinkedAt: "2026-06-05T18:00:00.000Z",
    lastSeenAt: "2026-06-05T18:00:00.000Z",
    lastInboundAt: "2026-06-05T18:00:00.000Z",
    linkedVia: "share",
    linkSource: "shortcut",
    ...over,
  };
}

describe("PgTokenStore (real SQL via pg-mem)", () => {
  it("round-trips a token record with exact shape (nulls → undefined, payload parsed)", async () => {
    const sql = makeSql();
    await migrate(sql);
    const s = new PgTokenStore(sql);
    await s.put(rec("t1", { payload: { kind: "url", url: "https://x.com", note: "n" } }));
    const got = await s.get("t1");
    expect(got).toMatchObject({ token: "t1", tokenClass: "anonymous", intent: "share", linkSource: "shortcut", ttl: 900 });
    expect(got?.payload).toEqual({ kind: "url", url: "https://x.com", note: "n" });
    expect(got?.consumedAt).toBeUndefined();
    expect(got?.pokeAccountIdRef).toBeUndefined();
    expect(await s.get("nope")).toBeUndefined();
  });

  it("enforces single-use via the SQL compare-and-set (won → replay → foreign; missing)", async () => {
    const sql = makeSql();
    await migrate(sql);
    const s = new PgTokenStore(sql);
    await s.put(rec("t2"));
    expect((await s.consume("t2", "A", "2026-06-05T18:01:00.000Z")).status).toBe("won");
    expect((await s.consume("t2", "A", "2026-06-05T18:02:00.000Z")).status).toBe("replay");
    expect((await s.consume("t2", "B", "2026-06-05T18:03:00.000Z")).status).toBe("foreign");
    expect((await s.consume("missing", "A", "2026-06-05T18:04:00.000Z")).status).toBe("missing");
    expect((await s.get("t2"))?.consumedBy).toBe("A");
  });

  it("preserves account-bound fields", async () => {
    const sql = makeSql();
    await migrate(sql);
    const s = new PgTokenStore(sql);
    await s.put(rec("t3", { tokenClass: "account-bound", ttl: 120, pokeAccountIdRef: "acct_7", consentRef: "c1" }));
    const got = await s.get("t3");
    expect(got?.tokenClass).toBe("account-bound");
    expect(got?.pokeAccountIdRef).toBe("acct_7");
    expect(got?.consentRef).toBe("c1");
  });
});

describe("PgContinuityStore (real SQL via pg-mem)", () => {
  it("upserts idempotently on opaqueId and maps nulls → undefined", async () => {
    const sql = makeSql();
    await migrate(sql);
    const s = new PgContinuityStore(sql);
    await s.put(link("opaqueA", { linkedVia: "share" }));
    expect((await s.get("opaqueA"))?.pokeAccountId).toBeUndefined();
    await s.put(link("opaqueA", { linkedVia: "open_chat", pokeAccountId: "acct_1", consentRef: "c1" }));
    const got = await s.get("opaqueA");
    expect(got?.linkedVia).toBe("open_chat");
    expect(got?.pokeAccountId).toBe("acct_1");
    expect(got?.consentRef).toBe("c1");
    expect(await s.get("nobody")).toBeUndefined();
  });
});
